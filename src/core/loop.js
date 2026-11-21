  // ---------- core/loop：投递循环（平台无关——所有页面动作经适配器） ----------
  // spec/apply-pipeline「关键词驱动的单循环投递」：词表逐词搜索，单页逐卡
  // 「归属校验 → JD → 判定 → 达标投递」，投满即停；单页耗尽换下一个词，词尽收尾。
  // 一次页面加载只投一条（红线）：投出即导航回搜索页，真实浏览器由重载驱动下一轮，
  // 测试台按页驱动。jsdom 下 navigate 是空操作（记 lastNav），所以单页处理到「第一次投出或换词」为止。
  const RUN_KEY = 'resumind_v2_run';

  function loadRun() {
    try {
      const r = JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null');
      return (r && Array.isArray(r.keywords)) ? r : null;
    } catch (e) { return null; }
  }

  function saveRun(r) {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(r));
  }

  function clearRun() {
    sessionStorage.removeItem(RUN_KEY);
  }

  function navigate(url) {
    window.__zp2 = window.__zp2 || {};
    window.__zp2.lastNav = url; // 测试台断言通道；真实页面无害
    location.href = url;        // jsdom 下是空操作；真实浏览器发起整页导航
  }

  /** 真投确认后的入口：落运行状态并站到第一个词的搜索页。 */
  function startRun(target, kws) {
    const run = {
      keywords: kws.slice(), target, sent: 0, wi: 0,
      startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0,
    };
    saveRun(run);
    pushLog(`▶ 开始：目标 ${target} 条，词表 ${kws.join(' → ')}。一次页面加载只投一条。`, 'good');
    return goToWord(run);
  }

  async function goToWord(run) {
    if (breathDue(run)) {
      const wait = takeBreath(run);
      pushLog(`☕ 喘口气 ${Math.round(wait / 1000)} 秒再导航（打破均匀间隔）。`);
      await sleep(wait);
    }
    saveRun(run);
    navigate(SITE_ADAPTER.searchUrl(run.keywords[run.wi]));
  }

  /** 单页处理：逐卡判定投递；投出一条即换页，页内耗尽换词，异常与红线立即收尾。 */
  async function runStep() {
    const run = loadRun();
    if (!run) return;
    const l = loadLedger();
    const s = gateSettings(l);
    const threshold = s.model.threshold;

    if (timeUp(run)) return finish(run, '会话到点，建议分批跑');
    if (tripped(run)) return finish(run, '连续失败熔断');
    const hit = SITE_ADAPTER.riskOverlay(document);
    if (hit) return stopForRisk(hit);

    for (const card of SITE_ADAPTER.listCards(document)) {
      if (timeUp(run)) return finish(run, '会话到点，建议分批跑');
      if (tripped(run)) return finish(run, '连续失败熔断');
      const ov = SITE_ADAPTER.riskOverlay(document);
      if (ov) return stopForRisk(ov);

      const jobId = SITE_ADAPTER.jobId(card);
      if (!jobId) continue;
      const r = l.jobs[jobId] || {};
      if (r.sentAt || r.claimedAt) continue;                          // 已投 / 占位：不碰
      if (alreadyJudged(l, jobId) && r.score < threshold) continue;   // 已判拒：不重判

      await sleep(pace(1500, 1500)); // 卡片间节奏（判定间 3~6 秒 @PACE=2）
      SITE_ADAPTER.selectCard(card);
      if (!(await SITE_ADAPTER.validateOwnership(jobId))) {
        if (noteFailure(run, `归属校验失败 ${jobId}`)) { saveRun(run); return finish(run, '连续失败熔断'); }
        saveRun(run);
        continue;
      }
      const jd = SITE_ADAPTER.scrapeJd(document);
      if (jd.status === 'thin') {
        pushLog(`↷ 「${SITE_ADAPTER.title(card)}」JD 过短（数据缺陷）——跳过，不占判定不计失败。`);
        saveRun(run);
        continue;
      }
      if (jd.status === 'missing') {
        if (noteFailure(run, `JD 抓不到 ${jobId}（页面形态变化？）`)) { saveRun(run); return finish(run, '连续失败熔断'); }
        saveRun(run);
        continue;
      }

      let v;
      if (alreadyJudged(l, jobId)) {
        v = { score: r.score, reason: r.reason, missing: r.missing }; // 判过匹配但未投出（中断遗留）→ 直接续投
      } else {
        v = await judge(l, jobId, { title: SITE_ADAPTER.title(card), company_name: '' }, jd);
        if (!v) {
          if (noteFailure(run, `判定失败 ${jobId}`)) { saveRun(run); return finish(run, '连续失败熔断'); }
          saveRun(run);
          continue;
        }
      }
      if (!passed(v, threshold)) { saveRun(run); continue; } // 拒判：同页下一条，不计失败

      if (!claimJob(l, jobId)) { saveRun(run); continue; }   // 占位幂等：中断遗留不重投
      const btn = SITE_ADAPTER.chatButton(document);
      if (!btn || btn.getAttribute('ka') !== 'cpc_job_list_chat_' + jobId) {
        // 点击前最后校验（纪律 2）：归属漂移绝不点击
        if (noteFailure(run, `点击前归属漂移 ${jobId}`)) { saveRun(run); return finish(run, '连续失败熔断'); }
        saveRun(run);
        continue;
      }
      btn.click();
      markSent(l, jobId);
      noteSuccess(run);
      run.sent++;
      saveRun(run);
      pushLog(`✅ 已投「${SITE_ADAPTER.title(card)}」（${v.score} 分）${run.sent}/${run.target}`, 'good');
      if (run.sent >= run.target) return finish(run, '投满目标');
      // 一次一投：投出即换页。投出后等待 10~20 秒（PACE=2）再导航。
      await sleep(pace(5000, 5000));
      return goToWord(run);
    }

    // 本页候选耗尽 → 下一个词；词尽收尾（无游标、无翻页遍历——spec 口径）
    run.wi++;
    if (run.wi >= run.keywords.length) return finish(run, '词表用尽');
    pushLog(`「${run.keywords[run.wi - 1]}」页内候选处理完 → 换「${run.keywords[run.wi]}」。`);
    return goToWord(run);
  }

  function finish(run, why) {
    clearRun();
    pushLog(`⏹ 收尾：${why}（本轮已投 ${run.sent}/${run.target}）。`, 'good');
  }

  function stopForRisk(hit) {
    clearRun();
    pushLog(`🛑 页面出现「${hit}」——立即停手交人工，不做任何重试或绕过。`, 'bad');
  }

  /** 每次页面加载的循环再入点：有运行状态就继续。 */
  function resumeLoop() {
    if (!SITE_ADAPTER) return;
    if (!SITE_ADAPTER.matchHosts.includes(location.host)) {
      pushLog(`⚠️ 当前站点（${location.host}）不在适配器支持清单，不动作。`);
      return;
    }
    if (loadRun()) runStep().catch((e) => {
      pushLog(`循环异常：${(e && e.message) || e}`, 'bad');
      const run = loadRun();
      if (run && noteFailure(run, '循环异常')) { saveRun(run); finish(run, '连续失败熔断'); }
    });
  }
