  // ---------- sites/zhipin：BOSS直聘适配器 ----------
  // 行为语义从 v0.6.x 的实测纪律提炼（编号指旧纪律头部，全套注释随代码迁入）：
  //  纪律 1：去重键只用 /job_detail/<id>.html 的 24 位加密 id；href 上的 securityId/pk 是请求级的，必须丢。
  //  纪律 2：归属校验——「立即沟通」按钮的 ka 必须 == cpc_job_list_chat_<jobId>，且轮询等待一致
  //          （面板切换有延迟，按钮一出现就查一次会整串 mismatch）。上限 25 秒，超时按失败计。
  //  纪律 6：搜索路径单复数形态都真实存在（/web/geek/jobs 与 /web/geek/job?query=）——@match /web/*，
  //          searchPath 以复数形态为基准。
  //  纪律 13：JD 抓取三支——ok（正文）/ thin（desc 专用节点有文本但不足 MIN_JD_CHARS：数据缺陷，
  //          跳过不占判定不计失败）/ missing（desc 节点全空：页面形态问题，计失败连击）；
  //          desc 链取「第一个够长的」而非「第一个非空的」（13 字节点曾把 128 字正文挡在链外）。
  const BTN_TIMEOUT_MS = Number(window.__ZP_BTN_TIMEOUT__) || 25000;

  const SITE_ADAPTER = {
    id: 'zhipin',
    matchHosts: ['www.zhipin.com'],
    searchPath: '/web/geek/jobs',
    riskPatterns: ['稍后再试', '频繁', '上限', '限额', '验证', '异常', '被封', '已被限制'],
    MIN_JD_CHARS: 20, // 低于此长度不算正文：<h3>职位描述</h3> 类标题或岗位没写（纪律 13）

    listCards(doc) {
      return Array.from(doc.querySelectorAll('li.job-card-box'));
    },

    jobId(card) {
      const a = card.querySelector('a.job-name');
      const m = a && /job_detail\/([A-Za-z0-9_~-]+)\.html/.exec(a.getAttribute('href') || '');
      return m ? m[1] : null;
    },

    title(card) {
      const a = card.querySelector('a.job-name');
      return (a && a.textContent.trim()) || '';
    },

    /** 选中卡片（右侧详情面板随之对准）。 */
    selectCard(card) {
      const a = card.querySelector('a.job-name');
      if (a) a.click();
    },

    /** 归属校验（轮询等待一致）：true = 按钮属于该职位可点击。 */
    async validateOwnership(jobId) {
      const end = Date.now() + BTN_TIMEOUT_MS;
      while (Date.now() < end) {
        const btn = document.getElementById('chatbtn');
        if (btn && btn.getAttribute('ka') === 'cpc_job_list_chat_' + jobId) return true;
        await sleep(300);
      }
      return false;
    },

    /** JD 抓取三支：{status:'ok'|'thin'|'missing', desc, salary}。 */
    scrapeJd(doc) {
      const nodes = doc.querySelectorAll('.job-sec-text, .job-detail-body, p.desc');
      const text = (n) => ((n && (n.innerText || n.textContent)) || '').trim();
      let best = '';
      for (const n of nodes) {
        const t = text(n);
        if (t.length >= this.MIN_JD_CHARS) { best = t; break; }
      }
      const salary = text(doc.querySelector('.job-detail-title .salary')) || text(doc.querySelector('.salary'));
      if (best) return { status: 'ok', desc: best.slice(0, 2500), salary };
      let anyText = false;
      for (const n of nodes) { if (text(n)) { anyText = true; break; } }
      return { status: anyText ? 'thin' : 'missing', desc: '', salary };
    },

    chatButton(doc) {
      return doc.getElementById('chatbtn');
    },

    /** 搜索 URL：保留当前页的用户筛选参数（city/experience 等），剥离 query/page/salary 与跟踪参数；
     *  只轮换 query——词表就是过滤器，没有推荐流伪关键词与薪资批次。 */
    searchUrl(keyword) {
      const sp = new URLSearchParams(location.search);
      ['ka', 'lid', 'securityId', 'pk', 'spam', '_', 'query', 'page', 'salary'].forEach((k) => sp.delete(k));
      if (!sp.get('city')) sp.set('city', '101010100');
      if (keyword) sp.set('query', keyword);
      return `https://www.zhipin.com${this.searchPath}?${sp.toString()}`;
    },

    riskOverlay(doc) {
      return riskOverlayHit(doc, this.riskPatterns);
    },
  };
