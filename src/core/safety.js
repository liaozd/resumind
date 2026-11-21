  // ---------- core/safety：熔断 / 风控停手 / 日志存续 ----------
  // 连续失败熔断：判定失败/点击失败连续达线即停——自动化坏了就该停，不能硬闯（纪律 8）。
  //   v2 语义简化：不再区分「自愈导航」分支（词表工程的产物已删），连续失败一条道走到熔断。
  // 风控停手：页面出现平台限制文案立即交回人工——具体文案由各站点适配器提供（STOP_WORDS 各站不同）。
  // 日志跨页存续：一次页面加载只投一条 → 每次导航都是一次「失忆」，日志进 sessionStorage 环形缓冲
  //  （纪律 7：DOM 日志一次刷新全清零，失败原因对用户不可见——F12 还会被反爬顶掉）。
  const MAX_CONSEC_FAILS = 5;
  const LOG_KEY = 'resumind_v2_log';
  const LOG_CAP = 200;

  /** 记一次失败。返回 true = 已达熔断线，调用方必须停手。 */
  function noteFailure(run, why) {
    run.failStreak = (run.failStreak || 0) + 1;
    pushLog(`✗ ${why}（连续失败 ${run.failStreak}/${MAX_CONSEC_FAILS}）`, 'bad');
    return tripped(run);
  }

  function noteSuccess(run) {
    run.failStreak = 0;
  }

  function tripped(run) {
    return (run.failStreak || 0) >= MAX_CONSEC_FAILS;
  }

  /** 风控/限制浮层检测：命中返回命中文案（供停手原因），否则 null。patterns 由适配器提供。 */
  function riskOverlayHit(doc, patterns) {
    if (!patterns || !patterns.length) return null;
    const text = (doc.body && doc.body.innerText) || '';
    for (const p of patterns) {
      if (p && text.indexOf(p) !== -1) return p;
    }
    return null;
  }

  /** 日志环形缓冲（sessionStorage，跨导航存续）+ 面板即时回显。日志失败绝不影响主流程。 */
  function pushLog(msg, kind) {
    try {
      const logs = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]');
      logs.push({ at: Date.now(), kind: kind || 'info', msg: String(msg).slice(0, 300) });
      while (logs.length > LOG_CAP) logs.shift();
      sessionStorage.setItem(LOG_KEY, JSON.stringify(logs));
    } catch (e) { /* 存不进去就算了 */ }
    logLine(msg);
  }

  function loadLogs() {
    try { return JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; }
  }
