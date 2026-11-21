  // ---------- core/ledger：账本 ----------
  // spec/apply-pipeline「防重发」：jobId 去重；点击前先写占位 claimedAt，投成回写 sentAt；
  // 中断后未结占位（有 claimedAt 无 sentAt）不自动重投——宁可少投一条，不可重复发送。
  // settings 持久化：model（端点/模型/阈值）、persona（画像）、keywords（词表）、target。
  // 新 namespace（resumind_v2），旧 v0.6.x 账本（zp_batch_v1）刻意不读不迁移——
  // 数据形态不同，混用即脏数据；BREAKING 已在 proposal 声明，浏览器里旧版数据自然弃用。
  // 判不了≠放行的账本表达：判定失败只进失败连击（core/safety），绝不写「已判过、放行」。

  const LEDGER_NS = 'resumind_v2';

  function loadLedger() {
    try {
      const l = JSON.parse(localStorage.getItem(LEDGER_NS) || 'null');
      if (l && typeof l === 'object' && l.jobs && l.settings) return l;
    } catch (e) { /* 损坏即重建：账本只服务去重与防重发，不值得为它上恢复仪式 */ }
    return { jobs: {}, settings: {}, days: {} };
  }

  function saveLedger(l) {
    localStorage.setItem(LEDGER_NS, JSON.stringify(l));
  }

  function jobRecord(l, jobId) {
    return (l.jobs[jobId] = l.jobs[jobId] || {});
  }

  /** 占位（点击前调用）：返回 false = 不可投（已投 / 未结占位），true = 已占位可点击。 */
  function claimJob(l, jobId) {
    const r = jobRecord(l, jobId);
    if (r.sentAt) return false;                       // 已投：去重
    if (r.claimedAt && !r.sentAt) return false;       // 未结占位：中断遗留，不自动重投
    r.claimedAt = Date.now();
    saveLedger(l);
    return true;
  }

  function markSent(l, jobId) {
    const r = jobRecord(l, jobId);
    r.sentAt = Date.now();
    saveLedger(l);
  }

  /** 判定落账（过审与拒判都落）：分数/理由/缺失，供「已判不再判」与人工复盘。 */
  function markVerdict(l, jobId, score, reason, missing) {
    const r = jobRecord(l, jobId);
    r.judgedAt = Date.now();
    r.score = score;
    r.reason = (reason || '').slice(0, 120);
    r.missing = missing || [];
    saveLedger(l);
  }

  /** 已判不再判（v2 简化语义：一条职位只判一次，无版本戳重验——拒判记忆与门禁版本解耦的
   *  整套 v0.6.x 机器在本版删除）。想重新判定某条：面板提供「清判定记录」（3.3 落地）。 */
  function alreadyJudged(l, jobId) {
    return !!(l.jobs[jobId] && l.jobs[jobId].judgedAt);
  }
