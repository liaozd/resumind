/**
 * v2 release 产物测试台（骨架起步，随任务逐步扩成完整套件；任务 5.1 收口时替换旧套件）。
 *
 * 为什么测 release 而不是测源片段：浏览器安装、jsdom 运行、用户拿到的都是拼装产物——
 * 拼装错误（片段顺序/作用域/站点注入/@match）只在产物上暴露。先 build 再测是铁律。
 *
 * jsdom 的两条补丁与真实浏览器语义对齐（沿用 v0.6.x 测试台结论）：
 *   - location.href 导航是空操作：导航目标断言 window.__zp2.lastNav；跨页场景用连续 loadDist 模拟。
 *   - sessionStorage 不跨 JSDOM 实例：用 seed 手动搬运（ledger / run）。
 *
 * 跑法：
 *   node src/build.js
 *   NODE_PATH=/tmp/zp-test/node_modules node src/test_batch_userscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0;
let fail = 0;
const failures = [];

function check(id, cond, note) {
  if (cond) { pass++; console.log(`  ✅ ${note}`); }
  else { fail++; failures.push(id); console.log(`  ❌ ${note}`); }
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 伪造 OpenAI 兼容响应：verdicts 按「标题子串 → {score, reason}」匹配；全部不命中 = 服务失败。 */
function fetchStub(verdicts) {
  return async (url, opts) => {
    let msg = '';
    try { msg = JSON.parse(opts.body).messages[1].content; } catch (e) { /* ignore */ }
    for (const key of Object.keys(verdicts)) {
      if (msg.indexOf(key) !== -1) {
        const v = verdicts[key];
        const content = `{"score": ${v.score}, "reason": "${v.reason || '匹配'}", "missing": []}`;
        return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
      }
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

/** 页面 fixture：卡片列表 + 详情面板（ka 静态——单页只会点击第一张合格卡）。 */
function fixtureHtml(fixture) {
  if (!fixture) return '';
  const ids = fixture.ids || [];
  const cards = ids.map((id, i) =>
    `<li class="job-card-box"><a class="job-name" href="/job_detail/${id}.html?securityId=SEC${i}&pk=${i}">职位${i} 测试岗</a><a href="/gongsi/c${i}.html">公司${i}</a></li>`).join('');
  const ka = fixture.ka || (ids[0] ? `cpc_job_list_chat_${ids[0]}` : 'cpc_job_list_chat_NONE');
  const jd = fixture.jd || '负责 Django 后端服务的开发与维护，要求 3 年以上 Python 经验，熟悉 MySQL、Redis。';
  const overlay = fixture.overlay ? `<div class="risk-overlay">${fixture.overlay}</div>` : '';
  const detail = `<div class="job-detail-header"><div class="job-detail-title"><span class="name">面板标题</span><span class="salary">15-25K</span></div></div>
    <div class="job-detail-body"><p class="desc">${fixture.thin ? '太短' : jd}</p></div>
    <a class="op-btn op-btn-chat" id="chatbtn" ka="${ka}">立即沟通</a>${overlay}`;
  return `<ul>${cards}</ul><div class="job-detail-container">${detail}</div>`;
}

function loadDist(siteId, url, opts = {}) {
  const releasePath = path.join(__dirname, '..', 'release', `${siteId}_batch.user.js`);
  const src = fs.readFileSync(releasePath, 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); // 吞掉 jsdom 不支持整页导航的噪音
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${fixtureHtml(opts.fixture)}</body></html>`, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window;
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });
  if (!win.AbortController) win.AbortController = AbortController; // 老版本 jsdom 兜底（judge 用它做超时）
  if (opts.ledger) win.localStorage.setItem('resumind_v2', JSON.stringify(opts.ledger));
  if (opts.run) win.sessionStorage.setItem('resumind_v2_run', JSON.stringify(opts.run));
  if (opts.logs) win.sessionStorage.setItem('resumind_v2_log', JSON.stringify(opts.logs));
  if (opts.hooks) Object.keys(opts.hooks).forEach((k) => { win[k] = opts.hooks[k]; });
  if (opts.fetch) win.fetch = opts.fetch;
  win.eval(src);
  return { dom, src };
}

const ZP_URL = 'https://www.zhipin.com/web/geek/jobs?city=101010100&query=django';
const FAST = { __ZP_PACE__: 0, __ZP_BTN_TIMEOUT__: 800 }; // 归属轮询 800ms 上限：失败路径场景不必等 2 秒
const A = ['jobAAA1111111111111111', 'jobBBB2222222222222222', 'jobCCC3333333333333333'];

(async () => {

console.log('\n[1] zhipin release：面板渲染 / 版本单一来源 / 站点注入');
{
  const { dom, src } = loadDist('zhipin', ZP_URL);
  const panel = dom.window.document.getElementById('zp2-panel');
  check('s1-panel-mounted', !!panel, '面板挂载到页面');
  check('s1-site-id', panel && panel.textContent.indexOf('zhipin') !== -1, '面板带站点标识');
  check('s1-version-rendered', panel && panel.textContent.indexOf('2.0.0-a1') !== -1, '面板渲染 build 注入的版本号');
  check('s1-version-single-source', /\$\{VERSION\}/.test(src) && !/v[0-9]+\.[0-9]+\.[0-9a-z]+<\/span>/.test(src) && (src.match(/@version /g) || []).length === 1,
    '版本号单一来源（@version 一处 + 面板插值，无第二处写死）');
  check('s1-site-injected', src.indexOf('const SITE_ID = "zhipin"') !== -1, 'SITE_ID 由 build 注入');
  dom.window.close();
}

console.log('\n[2] liepin release：占位适配器（只渲染不动作）');
{
  const { dom } = loadDist('liepin', 'https://www.liepin.com/zhaopin/');
  const panel = dom.window.document.getElementById('zp2-panel');
  check('s2-panel-mounted', !!panel, '猎聘产物面板挂载');
  check('s2-site-id', panel && panel.textContent.indexOf('liepin') !== -1, '站点标识 = liepin');
  check('s2-adapter-placeholder', panel && panel.textContent.indexOf('未就绪') !== -1, '占位适配器明示');
  dom.window.close();
}

console.log('\n[3] core/ledger：去重 / 占位防重发 / 中断不重投 / 损坏重建');
{
  const { dom } = loadDist('zhipin', ZP_URL, { hooks: FAST });
  const api = dom.window.__zp2;
  const l = api.loadLedger();
  check('s3-claim-first', api.claimJob(l, 'jobA') === true, '首投可占位');
  api.markSent(l, 'jobA');
  check('s3-sent-dedup', api.claimJob(l, 'jobA') === false, '已投去重');
  api.markVerdict(l, 'jobB', 8, '对口', ['英语']);
  check('s3-verdict-recorded', (() => { const r = api.loadLedger().jobs.jobB; return r.score === 8 && r.missing.length === 1; })(), '分数/理由/缺失落账');
  check('s3-already-judged', api.alreadyJudged(l, 'jobB') === true && !api.alreadyJudged(l, 'jobC'), '已判不再判（一条只判一次）');
  dom.window.close();
  const interrupted = { jobs: { jobX: { claimedAt: Date.now() - 60000 } }, settings: {}, days: {} };
  const d2 = loadDist('zhipin', ZP_URL, { ledger: interrupted, hooks: FAST });
  const l2 = d2.dom.window.__zp2.loadLedger();
  check('s3-interrupted-keep', d2.dom.window.__zp2.claimJob(l2, 'jobX') === false && !l2.jobs.jobX.sentAt, '中断遗留未结占位不自动重投');
  d2.dom.window.close();
  const d3 = loadDist('zhipin', ZP_URL, { hooks: FAST });
  d3.dom.window.localStorage.setItem('resumind_v2', '{corrupted!!');
  check('s3-corrupt-rebuild', !!d3.dom.window.__zp2.loadLedger().jobs, '损坏 JSON 重建空账本');
  d3.dom.window.close();
}

console.log('\n[4] core/pacing：pace 乘数 / 长呼吸 / 会话上限');
{
  const { dom } = loadDist('zhipin', ZP_URL, { hooks: { __ZP_PACE__: 1 } });
  const api = dom.window.__zp2;
  check('s4-pace-hook', api.PACE === 1, '测试钩子覆盖 PACE');
  const p1 = api.pace(10, 10);
  check('s4-pace-range', p1 >= 10 && p1 <= 20, `pace(10,10) 落在基值区间（${p1}）`);
  const run = { startedAt: Date.now(), lastBreathAt: Date.now() - 9 * 60 * 1000 };
  check('s4-breath-due', api.breathDue(run) === true, '超 8 分钟 → 长呼吸到期');
  const wait = api.takeBreath(run);
  check('s4-breath-window', wait >= 20000 && wait <= 40000, `长呼吸落在基值区间（${wait}ms @PACE=1）`);
  check('s4-breath-refreshed', api.breathDue(run) === false, '呼吸后计时刷新');
  check('s4-timeup', api.timeUp({ startedAt: Date.now() - 41 * 60 * 1000 }) === true, '会话超 40 分钟 → timeUp');
  dom.window.close();
}

console.log('\n[5] core/safety：连续失败熔断 / 风控停手 / 日志跨页存续');
{
  const { dom } = loadDist('zhipin', ZP_URL, { hooks: FAST });
  const api = dom.window.__zp2;
  const run = { startedAt: Date.now() };
  let trippedNow = false;
  for (let i = 0; i < api.MAX_CONSEC_FAILS; i++) trippedNow = api.noteFailure(run, '判定失败');
  check('s5-fuse', trippedNow === true && api.tripped(run) === true, `连续 ${api.MAX_CONSEC_FAILS} 次失败 → 熔断`);
  api.noteSuccess(run);
  check('s5-reset', api.tripped(run) === false, '投出即清零');
  const overlay = dom.window.document.createElement('div');
  overlay.textContent = '操作过于频繁，请稍后再试';
  dom.window.document.body.appendChild(overlay);
  check('s5-overlay-hit', api.riskOverlayHit(dom.window.document, ['稍后再试']) === '稍后再试', '浮层文案命中');
  check('s5-overlay-clean', api.riskOverlayHit(dom.window.document, ['今日限额已用完']) === null, '无命中不误停');
  api.pushLog('跨页日志测试', 'info');
  check('s5-log-persist', api.loadLogs().some((e) => e.msg === '跨页日志测试'), '日志进环形缓冲');
  dom.window.close();
  const d2 = loadDist('zhipin', ZP_URL, { hooks: FAST });
  check('s5-log-key', d2.dom.window.localStorage.getItem('resumind_v2') === null, '日志键与账本键分离');
  d2.dom.window.close();
}

console.log('\n[6] core/gate：画像进 prompt / 阈值边界 / 判不了不放行');
{
  const led = {
    jobs: {}, days: {},
    settings: {
      cv: '8 年内容运营，全平台矩阵粉丝 120w+，擅长从 0 到 1 起号',
      persona: { direction: '用户增长（自定义测试方向）' },
      model: { endpoint: 'http://127.0.0.1:8080', model: 'test-model', threshold: 7 },
    },
  };
  const { dom } = loadDist('zhipin', ZP_URL, { ledger: led, hooks: FAST });
  const api = dom.window.__zp2;
  const l = api.loadLedger();
  const s = api.gateSettings(l);
  check('s6-persona-merge', s.persona.direction === '用户增长（自定义测试方向）' && s.persona.scope.indexOf('品牌内容') !== -1, '画像字段缺省回落出厂默认');
  check('s6-model-merge', s.model.model === 'test-model' && s.model.threshold === 7 && s.model.max_tokens === 320, '模型配置部分覆盖 + 默认补齐');
  check('s6-gate-enabled', api.gateEnabled(s) === true, 'CV + 端点在场 → 门禁启用');
  const { user } = api.buildGateMessages(s, { title: '内容运营专员', company_name: '某公司' }, { desc: '负责账号日常内容产出与数据复盘。', salary: '15-25K' });
  check('s6-prompt-persona', user.indexOf('用户增长（自定义测试方向）') !== -1 && user.indexOf('纯直播带货') !== -1, '判定 prompt 含画像与排除项');
  check('s6-prompt-no-trait-directives', user.indexOf('MUST NOT') === -1 && user.indexOf('满足项') === -1,
    'prompt 无画像特质相关的行为指令（判定完全按简历如实对照——个性化规则不得回流）');
  check('s6-prompt-lean', user.split('\n').length <= 24, `prompt 保持精简（${user.split('\n').length} 行）`);
  // 匹配要点蒸馏（v0.6.13 教训延续）：CV 带 ## 匹配要点 段 → 该段前置 + 全文随后；无该段 → 全文照旧
  const sBrief = { cv: '## 匹配要点\n- 8 年内容运营，粉丝 120w+\n\n## 个人简介\n详细经历若干字', persona: null, model: s.model };
  const { user: uBrief } = api.buildGateMessages(sBrief, { title: 'x', company_name: '' }, { desc: 'x' });
  check('s6-brief-first', uBrief.indexOf('匹配要点') < uBrief.indexOf('个人简介') && uBrief.indexOf('（以下是简历全文，用于核对细节）') !== -1,
    '匹配要点段前置、全文随后（v0.6.13 蒸馏语义延续）');
  const { user: uPlain } = api.buildGateMessages({ cv: '无匹配要点段的简历', persona: null, model: s.model }, { title: 'x', company_name: '' }, { desc: 'x' });
  check('s6-brief-optional', uPlain.indexOf('（以下是简历全文，用于核对细节）') === -1, '无匹配要点段 → 全文照旧');
  check('s6-parse-fence', api.parseVerdict('判定如下\n```json\n{"score": 8, "reason": "对口", "missing": []}\n```').score === 8, '围栏 JSON 可解析');
  check('s6-parse-clamp', api.parseVerdict('{"score": 99, "reason": "x"}').score === 10, '分数钳到 0-10');
  check('s6-parse-garbage', api.parseVerdict('这个职位不太行。') === null, '废话输出 → null');
  check('s6-threshold-boundary', api.passed({ score: 7 }, 7) === true && api.passed({ score: 6 }, 7) === false, '阈值边界 ≥7 过 / 6 不过');
  const dOffline = loadDist('zhipin', ZP_URL, { ledger: led, hooks: FAST });
  const api2 = dOffline.dom.window.__zp2;
  check('s6-offline-null', (await api2.judge(api2.loadLedger(), 'jobZ', { title: 'x', company_name: '' }, { desc: 'x' })) === null, '服务不可达 → null（判不了≠放行）');
  check('s6-offline-logged', api2.loadLogs().some((e) => e.msg.indexOf('LLM 请求失败') !== -1), '失败原因进日志');
  dOffline.dom.window.close();
  const dOk = loadDist('zhipin', ZP_URL, {
    ledger: led, hooks: FAST,
    fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"score": 9, "reason": "直接证据", "missing": ["英语"]}' } }] }) }),
  });
  const apiOk = dOk.dom.window.__zp2;
  const vOk = await apiOk.judge(apiOk.loadLedger(), 'jobOk', { title: 'x', company_name: '' }, { desc: 'x' });
  check('s6-judge-ok', vOk && vOk.score === 9, '判定成功返回 verdict');
  check('s6-judge-recorded', apiOk.alreadyJudged(apiOk.loadLedger(), 'jobOk') === true, '判定落账');
  dOk.dom.window.close();
}

console.log('\n[7] panel：配置持久化 / 真投确认框（唯一 staging）');
{
  const led = {
    jobs: {}, days: {},
    settings: {
      cv: '示例 CV', model: { endpoint: 'http://127.0.0.1:8080', model: 'm1', threshold: 7 },
      keywords: ['django', 'flask'], target: 2,
    },
  };
  const { dom } = loadDist('zhipin', ZP_URL, { ledger: led, hooks: FAST });
  const doc = dom.window.document;
  const api = dom.window.__zp2;
  // 配置改动即持久化
  doc.getElementById('zp2-cv').value = '改过的 CV';
  doc.getElementById('zp2-cv').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('s7-persist', api.loadLedger().settings.cv === '改过的 CV', '面板改动即写账本');
  // 开始 → 确认框出现
  doc.getElementById('zp2-start').click();
  const confirmBox = doc.getElementById('zp2-confirm');
  check('s7-confirm-shown', confirmBox.style.display !== 'none' && confirmBox.textContent.indexOf('真投确认') !== -1, '真投前先出确认框');
  check('s7-run-not-started', api.loadRun() === null, '确认前不落运行状态');
  // 取消 → 收起且无运行
  doc.getElementById('zp2-confirm-no').click();
  check('s7-cancel', confirmBox.style.display === 'none' && api.loadRun() === null, '取消 → 收起且不启动');
  // 确认 → 运行状态落地 + 导航到第一个词
  doc.getElementById('zp2-start').click();
  doc.getElementById('zp2-confirm-go').click();
  const run = api.loadRun();
  check('s7-confirmed-run', run && run.target === 2 && JSON.stringify(run.keywords) === '["django","flask"]', '确认后运行状态落地（目标/词表）');
  const nav = decodeURIComponent(dom.window.__zp2.lastNav || '');
  check('s7-nav-first-word', nav.indexOf('query=django') !== -1, `确认后站到第一个词的搜索页（${nav}）`);
  dom.window.close();
}

console.log('\n[8] 投递循环：判定达标才投 / 一次一投 / 换词 / 熔断 / 风控 / 薄JD');
{
  // [8a] 第一张卡判定 9 分 → 占位 → 投出 → 投满收尾（target 1）
  const led8 = { jobs: {}, days: {}, settings: { cv: '示例 CV', model: { endpoint: 'http://127.0.0.1:8080', model: 'm1', threshold: 7 } } };
  const d8a = loadDist('zhipin', ZP_URL, {
    ledger: led8, hooks: FAST,
    run: { keywords: ['django'], target: 1, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: A, ka: `cpc_job_list_chat_${A[0]}` },
    fetch: fetchStub({ '职位0': { score: 9 } }),
  });
  await settle(2500);
  const p8a = d8a.dom.window.__zp2.loadLedger();
  const rec8a = p8a.jobs[A[0]] || {};
  check('s8a-sent', !!rec8a.sentAt && !!rec8a.claimedAt, `达标职位已占位并投出（debug: jobs=${Object.keys(p8a.jobs)} logs=${JSON.stringify(d8a.dom.window.__zp2.loadLogs().map((x) => x.msg))} run=${JSON.stringify(d8a.dom.window.__zp2.loadRun())}）`);
  check('s8a-score', p8a.jobs[A[0]].score === 9, '分数落账');
  check('s8a-finish', d8a.dom.window.__zp2.loadRun() === null, '投满目标 → 运行收尾清状态');
  check('s8a-log', d8a.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('已投') !== -1), '投出留痕进日志');
  d8a.dom.window.close();

  // [8b] 拒判跳过不点击；页内耗尽换词；归属失败计失败连击
  const d8b = loadDist('zhipin', ZP_URL, {
    ledger: JSON.parse(JSON.stringify(led8)), hooks: FAST,
    run: { keywords: ['django', 'flask'], target: 5, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: A, ka: `cpc_job_list_chat_${A[0]}` },
    fetch: fetchStub({ '职位0': { score: 3 } }), // 只有职位0 有判定：3 分拒
  });
  await settle(4000);
  const api8b = d8b.dom.window.__zp2;
  const run8b = api8b.loadRun();
  check('s8b-reject-skip', (api8b.loadLedger().jobs[A[0]] || {}).score === 3 && !(api8b.loadLedger().jobs[A[0]] || {}).sentAt, '拒判不点击');
  check('s8b-failstreak', (run8b && run8b.failStreak === 2) || api8b.loadLogs().some((e) => e.msg.indexOf('归属校验失败') !== -1),
    'ka 不匹配的卡片计归属失败（A1/A2 轮询超时，不计入拒判）');
  const nav8b = decodeURIComponent(dom8b_lastNav(d8b));
  check('s8b-next-word', nav8b.indexOf('query=flask') !== -1, `页内耗尽换下一个词（${nav8b}）`);
  d8b.dom.window.close();

  // [8c] 连续失败熔断：failStreak=4 + 判定服务挂 → 第 5 次失败即熔断收尾
  const d8c = loadDist('zhipin', ZP_URL, {
    ledger: JSON.parse(JSON.stringify(led8)), hooks: FAST,
    run: { keywords: ['django'], target: 5, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 4 },
    fixture: { ids: [A[0]], ka: `cpc_job_list_chat_${A[0]}` },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  await settle(2500);
  check('s8c-fuse', d8c.dom.window.__zp2.loadRun() === null && d8c.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('熔断') !== -1),
    '第 5 次连续失败 → 熔断收尾（判不了≠放行）');
  d8c.dom.window.close();

  // [8d] 风控浮层 → 立即停手
  const d8d = loadDist('zhipin', ZP_URL, {
    ledger: JSON.parse(JSON.stringify(led8)), hooks: FAST,
    run: { keywords: ['django'], target: 5, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: A, ka: `cpc_job_list_chat_${A[0]}`, overlay: '操作过于频繁，请稍后再试' },
    fetch: fetchStub({ '职位0': { score: 9 } }),
  });
  await settle(2000);
  check('s8d-risk-stop', d8d.dom.window.__zp2.loadRun() === null && d8d.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('停手') !== -1),
    '风控文案出现 → 停手交人工（零点击）');
  check('s8d-zero-click', !(d8d.dom.window.__zp2.loadLedger().jobs[A[0]] || {}).claimedAt, '风控下零占位零点击');
  d8d.dom.window.close();

  // [8e] 薄 JD → 跳过不占判定不计失败
  const d8e = loadDist('zhipin', ZP_URL, {
    ledger: JSON.parse(JSON.stringify(led8)), hooks: FAST,
    run: { keywords: ['django'], target: 5, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: [A[0]], ka: `cpc_job_list_chat_${A[0]}`, thin: true },
    fetch: fetchStub({}),
  });
  await settle(2500);
  check('s8e-thin-skip', d8e.dom.window.__zp2.loadRun() === null && (d8e.dom.window.__zp2.loadLedger().jobs[A[0]] || {}).judgedAt === undefined
    && d8e.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('JD 过短') !== -1),
    '薄 JD 跳过：不判定不计失败，页内耗尽 → 词尽收尾（单词表）');
  d8e.dom.window.close();

  // [8f] 词表用尽收尾（无游标）
  const d8f = loadDist('zhipin', ZP_URL, {
    ledger: { jobs: { [A[0]]: { judgedAt: Date.now(), score: 2 } }, days: {}, settings: { cv: 'CV', model: { endpoint: 'http://127.0.0.1:8080', model: 'm1', threshold: 7 } } },
    hooks: FAST,
    run: { keywords: ['django'], target: 5, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: [A[0]], ka: `cpc_job_list_chat_${A[0]}` },
    fetch: fetchStub({}),
  });
  await settle(2000);
  check('s8f-words-out', d8f.dom.window.__zp2.loadRun() === null && d8f.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('词表用尽') !== -1),
    '已判拒的卡不重判，词表用尽 → 收尾（无游标无翻页）');
  d8f.dom.window.close();
}

console.log('\n[10] 关键词生成：只填词表待人审 / 失败词表不动 / 不自动启动投递');
{
  const led10 = {
    jobs: {}, days: {},
    settings: { cv: '示例 CV', model: { endpoint: 'http://127.0.0.1:8080', model: 'm1', threshold: 7 }, keywords: ['旧词'], target: 5 },
  };
  // 成功路径：生成词填输入框，settings.keywords 不被生成自动改写、投递不自动启动
  const d10 = loadDist('zhipin', ZP_URL, {
    ledger: led10, hooks: FAST,
    fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '如下\n```json\n{"keywords": ["内容运营", "小红书运营", "用户增长"]}\n```' } }] }) }),
  });
  const doc10 = d10.dom.window.document;
  const api10 = d10.dom.window.__zp2;
  doc10.getElementById('zp2-gen').click();
  await settle(800);
  check('s10-filled', doc10.getElementById('zp2-kws').value === '内容运营, 小红书运营, 用户增长', '生成词填入词表输入框（待审）');
  check('s10-not-persisted', api10.loadLedger().settings.keywords.join(',') === '旧词', '生成不自动持久化词表（点「开始投递」确认后才生效）');
  check('s10-no-run', api10.loadRun() === null, '生成不自动启动投递');
  // 失败路径：服务挂 → 词表原样
  const d10b = loadDist('zhipin', ZP_URL, { ledger: led10, hooks: FAST, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const doc10b = d10b.dom.window.document;
  doc10b.getElementById('zp2-gen').click();
  await settle(800);
  check('s10b-fail-untouched', doc10b.getElementById('zp2-kws').value === '旧词' && d10b.dom.window.__zp2.loadLogs().some((e) => e.msg.indexOf('生成失败') !== -1 || e.msg.indexOf('LLM 请求失败') !== -1),
    '服务不可达 → 词表原样 + 原因明示');
  d10b.dom.window.close();
  d10.dom.window.close();
}

console.log('\n[9] 站点识别：不在适配器清单的 host 不动作');
{
  const { dom } = loadDist('zhipin', 'https://example.com/some/page', {
    ledger: { jobs: {}, days: {}, settings: { cv: 'CV', model: { endpoint: 'http://127.0.0.1:8080', model: 'm', threshold: 7 } } },
    hooks: FAST,
    run: { keywords: ['x'], target: 1, sent: 0, wi: 0, startedAt: Date.now(), lastBreathAt: Date.now(), failStreak: 0 },
    fixture: { ids: [A[0]], ka: `cpc_job_list_chat_${A[0]}` },
    fetch: fetchStub({ '职位0': { score: 9 } }),
  });
  await settle(2000);
  check('s9-host-guard', dom.window.__zp2.loadRun() !== null && !(dom.window.__zp2.loadLedger().jobs[A[0]] || {}).sentAt,
    '未知站点：运行状态原样保留、零动作（spec/站点自动识别的反例面）');
  dom.window.close();
}

console.log(`\n结果：${pass} 过 / ${fail} 挂${fail ? ' ｜ 失败: ' + failures.join(', ') : ''}`);
process.exit(fail ? 1 : 0);
})();

function dom8b_lastNav(d) {
  return (d.dom.window.__zp2 && d.dom.window.__zp2.lastNav) || '';
}
