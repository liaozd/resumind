  // ---------- 启动 ----------
  // 启动序：面板 → 测试钩子 → 站点识别 → 循环再入。适配器缺失（骨架期）只渲染不动作——
  // 判不了≠放行的骨架表达。循环再入 = 每次页面加载检查运行状态（一次一投由导航驱动）。
  try {
    mountPanel();
  } catch (e) {
    // 面板挂载失败不能拖垮页面——用户页面永远比我们的面板重要
    console.warn('[resumind] 面板挂载失败：', e);
  }

  // 测试台钩子（与 v0.6.x 的 __zpBatch 同模式）：内部函数经此暴露给 jsdom 场景断言；真实页面无害。
  // 只暴露纯函数与可观测状态，不暴露会直接点页面按钮的入口。
  window.__zp2 = {
    loadLedger, saveLedger, claimJob, markSent, markVerdict, alreadyJudged,
    pace, sleep, breathDue, takeBreath, timeUp, PACE, MAX_RUN_MS, BREATH_EVERY_MS,
    noteFailure, noteSuccess, tripped, riskOverlayHit, pushLog, loadLogs, MAX_CONSEC_FAILS,
    gateSettings, gateEnabled, buildGateMessages, parseVerdict, judge, passed,
    llmChat, buildGenMessages, parseKeywordList, generateKeywords,
    MODEL_PRESETS, DEFAULT_MODEL, DEFAULT_PERSONA, personaBlock, effectivePersona,
    loadRun, saveRun, clearRun, startRun, runStep, navigate, collectWords,
    adapter: SITE_ADAPTER,
    logLine,
  };

  try {
    resumeLoop();
  } catch (e) {
    console.warn('[resumind] 循环再入失败：', e);
  }
