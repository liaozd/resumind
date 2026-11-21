  // ---------- core/pacing：节奏底线（v0.6.x 纪律 9/20 的提炼，账号安全核心） ----------
  // 所有步进间隔必须走 pace()——禁止字面毫秒数。教训（纪律 9）：跳过分支天然绕过节流，
  // 漏一处等待就是「连点手感」，省下的秒数代价是账号。
  // PACE 是唯一节奏旋钮：风控收紧只调它，不改各处基值。出厂 2（实投后换页 10~20 秒、
  // 判定间 5~10 秒、换词 8~16 秒）；测试台经 window.__ZP_PACE__ 覆盖。
  // PACE=0 是合法测试档位（零等待）——不能用 || 2 兜底（0 是 falsy，会把测试静默变慢档）。
  // 用 nullish 判定：未设置才回落出厂 2。
  const PACE = (window.__ZP_PACE__ == null || window.__ZP_PACE__ === '') ? 2 : Number(window.__ZP_PACE__);
  const pace = (base, rand) => Math.round((base + Math.random() * (rand || 0)) * PACE);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 长呼吸（纪律 20 保留）：距上次导航超 8 分钟，导航前插入一次远超常规的停顿——
  // 打破「均匀随机间隔」的统计特征（人的停顿是不规律的）。基值 20~40s，PACE=2 时 40~80 秒。
  const BREATH_EVERY_MS = Number(window.__ZP_BREATH__) || 8 * 60 * 1000;
  function breathDue(run) {
    return Date.now() - (run.lastBreathAt || run.startedAt || Date.now()) >= BREATH_EVERY_MS;
  }
  function takeBreath(run) {
    run.lastBreathAt = Date.now();
    return pace(20000, 20000);
  }

  // 会话时长上限：到点收尾建议分批跑——长时间连续在线是被风控识别的主因（纪律 20 实测）。
  // 测试台经 window.__ZP_MAX_RUN__ 覆盖。
  const MAX_RUN_MS = Number(window.__ZP_MAX_RUN__) || 40 * 60 * 1000;
  function timeUp(run) {
    return Date.now() - (run.startedAt || Date.now()) >= MAX_RUN_MS;
  }
