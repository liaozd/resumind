  // ---------- core/gate：极简门禁 ----------
  // 判不了≠放行（红线）：LLM 不可达 / 输出不可解析 = 返回 null，调用方计入失败连击——
  // 绝不静默放行。prompt = 静态模板 + 画像直出（config/persona），为轻量小模型设计：
  // 两行锚点、无独立规则段——规则越多小模型越跟不住，排除项由画像一行带入。
  // settings 组装：model/persona 缺字段回落出厂默认（用户只填一半也不炸）。
  function gateSettings(l) {
    return {
      model: Object.assign({}, DEFAULT_MODEL, l.settings.model || {}),
      persona: effectivePersona(l.settings.persona),
      cv: (l.settings.cv || '').trim(),
    };
  }

  function gateEnabled(s) {
    return !!(s.cv && s.model.endpoint);
  }

  /** 「匹配要点」蒸馏段（v0.6.13 教训延续）：CV 里 ## 匹配要点 段前置注入，全文随后——
   *  方向与直接证据在开头，小模型不用在长文里翻；没写该段就全文照旧
   *  （模板引导用户写，脚本不做结构校验、不报错）。 */
  function cvBrief(s) {
    const cvFull = s.cv;
    const mk = cvFull.indexOf('## 匹配要点');
    if (mk === -1) return cvFull;
    const next = cvFull.indexOf('\n## ', mk + 1);
    const brief = (next === -1 ? cvFull.slice(mk) : cvFull.slice(mk, next)).trim();
    return [brief, '', '（以下是简历全文，用于核对细节）', cvFull].join('\n');
  }

  /** 判定 prompt（spec：短锚点 + 画像 + 输出格式，总共 ~21 行）。 */
  function buildGateMessages(s, job, jd) {
    const sys = '你是严谨的求职匹配评估器。只输出一个 JSON 对象，不要任何其他文字、解释或代码块标记。';
    const user = [
      '## 求职者简历',
      cvBrief(s),
      '',
      personaBlock(s.persona),
      '',
      '## 职位',
      `标题：${job.title}`,
      `公司：${job.company_name || '未知'}`,
      `薪资：${jd.salary || '未知'}`,
      '职位描述：',
      jd.desc,
      '',
      '## 任务',
      '从专业能力、经验、学历、领域背景评估该求职者与职位的匹配度，打 0-10 分。',
      '锚点：9-10 = 方向对口、核心要求全满足、简历中有直接证据；7-8 = 对口、个别次要要求缺失（写入 missing）；5-6 = 方向相关但存在实质缺口；0-4 = 硬拒（明文排除方向、核心技能完全缺失、经验学历明显差档）。',
      '只输出 JSON：{"score": <0-10 的整数>, "reason": "<一句话理由>", "missing": ["<缺失的关键要求>"]}',
    ].join('\n');
    return { sys, user };
  }

  /** 输出解析：容忍 markdown 围栏与前后废话，取首个 {...} 块；分数钳到 0-10。 */
  function parseVerdict(text) {
    if (!text) return null;
    const s = String(text).replace(/```json|```/g, '');
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i === -1 || j <= i) return null;
    try {
      const v = JSON.parse(s.slice(i, j + 1));
      const score = Math.max(0, Math.min(10, Math.round(Number(v.score))));
      if (Number.isNaN(score)) return null;
      return {
        score,
        reason: typeof v.reason === 'string' ? v.reason : '',
        missing: Array.isArray(v.missing) ? v.missing.map(String).slice(0, 5) : [],
      };
    } catch (e) {
      return null;
    }
  }

  /** LLM 通道（判定与生成共用同一端点/模型配置）。成功返回消息文本；失败 null（原因进日志）。 */
  async function llmChat(s, sys, user, maxTokens) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(s.model.endpoint.replace(/\/+$/, '') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.model.model,
          temperature: 0.1,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message
        && data.choices[0].message.content;
      if (!text) throw new Error('空响应');
      return text;
    } catch (e) {
      pushLog(`⚠️ LLM 请求失败：${(e && e.message) || e}`, 'bad');
      return null;
    }
  }

  /** 判定：成功返回 {score, reason, missing}（已落账），失败返回 null（已计失败连击）。
   *  jobId 由调用方传入——账本键归投递循环管，门禁只管判。 */
  async function judge(l, jobId, job, jd) {
    const s = gateSettings(l);
    const { sys, user } = buildGateMessages(s, job, jd);
    const text = await llmChat(s, sys, user, s.model.max_tokens);
    if (text == null) return null;
    const v = parseVerdict(text);
    if (!v) {
      pushLog(`判定失败：${job.title || jobId}｜输出不可解析`, 'bad');
      return null;
    }
    markVerdict(l, jobId, v.score, v.reason, v.missing);
    return v;
  }

  function passed(v, threshold) {
    return !!v && v.score >= threshold;
  }

  // ---------- 关键词生成（spec「关键词生成」）----------
  // 用户原话「通过生成的关键词来过滤、判断、投送」。收缩口径：一个按钮，CV+画像 → 5~10 词
  // **只填词表输入框待人审**——确认框才是唯一 staging；失败词表原样不动。
  // v0.6.x 的自动探索/迷你探索/复盘/退场记账不回归。

  function buildGenMessages(s) {
    const sys = '你是求职搜索词规划器。只输出一个 JSON 对象，不要任何其他文字、解释或代码块标记。';
    const user = [
      '## 求职者简历',
      s.cv,
      '',
      personaBlock(s.persona),
      '',
      '## 任务',
      '按上面的简历与求职方向生成 5~10 个求职网站的搜索关键词：职能/平台/技能词，2~8 个字，不要长组合词。',
      '只输出 JSON：{"keywords": ["词1", "词2", ...]}',
    ].join('\n');
    return { sys, user };
  }

  function parseKeywordList(text) {
    if (!text) return null;
    const s2 = String(text).replace(/```json|```/g, '');
    const i = s2.indexOf('{');
    const j = s2.lastIndexOf('}');
    if (i === -1 || j <= i) return null;
    try {
      const v = JSON.parse(s2.slice(i, j + 1));
      const kws = Array.isArray(v.keywords)
        ? v.keywords.map((x) => String(x).trim()).filter(Boolean).slice(0, 10)
        : [];
      return kws.length ? kws : null;
    } catch (e) {
      return null;
    }
  }

  /** 生成：成功返回词数组（不落账、不自动开跑——填词待人审是面板的事）；失败 null。 */
  async function generateKeywords(l) {
    const s = gateSettings(l);
    if (!gateEnabled(s)) {
      pushLog('⚠️ 生成需要先粘贴 CV（生成按 CV 定向）。', 'bad');
      return null;
    }
    const { sys, user } = buildGenMessages(s);
    const text = await llmChat(s, sys, user, 500);
    const kws = parseKeywordList(text);
    if (!kws) {
      pushLog('⚠️ 生成失败（服务不可达或输出不可解析），词表保持原样。', 'bad');
      return null;
    }
    return kws;
  }
