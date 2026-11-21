  // ---------- 面板 ----------
  // v2 简化面板：模型档 → CV → 画像 → 词表/目标 → 开始投递（确认框）→ 日志。
  // 没有词表工程/探索/复盘的任何 UI——流程一条直线（spec/apply-pipeline）。
  // 面板改动即持久化（写账本 settings），断点重开不丢配置。
  // 渲染纪律：版本号走 ${VERSION} 插值，面板无第二处写死版本号。

  const STYLE_BASE = [
    'position:fixed', 'top:80px', 'right:16px', 'z-index:2147483000',
    'width:340px', 'padding:10px', 'background:#fff', 'border:1px solid #d0d7de',
    'border-radius:6px', 'font:12px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    'color:#1f2328', 'box-shadow:0 2px 8px rgba(0,0,0,.15)',
  ].join(';');
  const STYLE_INPUT = 'width:100%;box-sizing:border-box;margin:2px 0 6px;padding:4px;border:1px solid #d0d7de;border-radius:4px;font:inherit';
  const STYLE_BTN = 'width:100%;padding:6px;border:1px solid #1e8e3e;border-radius:4px;background:#1e8e3e;color:#fff;cursor:pointer;font:inherit';
  const STYLE_LABEL = 'font-weight:600;margin-top:4px;display:block';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mountPanel() {
    const old = document.getElementById('zp2-panel');
    if (old) old.remove();
    const l = loadLedger();
    const s = gateSettings(l);
    const presetOptions = Object.keys(MODEL_PRESETS).map((k) =>
      `<option value="${k}">${esc(MODEL_PRESETS[k].label)}</option>`).join('');
    const box = document.createElement('div');
    box.id = 'zp2-panel';
    box.style.cssText = STYLE_BASE;
    box.innerHTML = [
      `<div style="font-weight:600;margin-bottom:4px">Resumind v2 · ${SITE_ID} <span style="color:#8b949e">v${VERSION}</span></div>`,
      '<label class="zp2-l">模型档（一键填，可改）</label>',
      `<select id="zp2-preset" style="${STYLE_INPUT}">${presetOptions}</select>`,
      '<label class="zp2-l">端点（OpenAI 兼容；外接 = 数据出本机）</label>',
      `<input id="zp2-endpoint" style="${STYLE_INPUT}" value="${esc(s.model.endpoint)}">`,
      '<label class="zp2-l">模型名（轻量本地小模型直接填型号）</label>',
      `<input id="zp2-model" style="${STYLE_INPUT}" value="${esc(s.model.model)}">`,
      '<label class="zp2-l">投递阈值（≥ 此分才投）</label>',
      `<input id="zp2-threshold" type="number" min="1" max="10" style="${STYLE_INPUT}" value="${esc(s.model.threshold)}">`,
      '<label class="zp2-l">简历 CV（markdown；门禁按此判定）</label>',
      `<textarea id="zp2-cv" rows="4" style="${STYLE_INPUT}">${esc(s.cv)}</textarea>`,
      '<label class="zp2-l">画像：目标方向</label>',
      `<input id="zp2-direction" style="${STYLE_INPUT}" value="${esc(s.persona.direction)}">`,
      '<label class="zp2-l">画像：岗位形态限定</label>',
      `<input id="zp2-scope" style="${STYLE_INPUT}" value="${esc(s.persona.scope)}">`,
      '<label class="zp2-l">画像：求职意向</label>',
      `<input id="zp2-role" style="${STYLE_INPUT}" value="${esc(s.persona.role)}">`,
      '<label class="zp2-l">画像：明确排除（硬拒）</label>',
      `<input id="zp2-exclusions" style="${STYLE_INPUT}" value="${esc(s.persona.exclusions)}">`,
      '<label class="zp2-l">关键词（逗号分隔，逐词搜索）</label>',
      `<input id="zp2-kws" style="${STYLE_INPUT}" value="${esc((l.settings.keywords || []).join(', '))}">`,
      `<button id="zp2-gen" style="width:100%;padding:4px;margin-bottom:6px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;cursor:pointer;font:inherit">按 CV 生成关键词（只填词表待人审）</button>`,
      '<label class="zp2-l">目标条数</label>',
      `<input id="zp2-target" type="number" min="1" style="${STYLE_INPUT}" value="${esc(l.settings.target || 10)}">`,
      `<button id="zp2-start" style="${STYLE_BTN}">开始投递（真投需确认）</button>`,
      '<div id="zp2-confirm" style="display:none;margin-top:6px;padding:8px;border:1px solid #d1242f;border-radius:4px;background:#fff8f8"></div>',
      '<div id="zp2-log" style="max-height:200px;overflow:auto;white-space:pre-wrap;color:#57606a;margin-top:6px"></div>',
    ].join('');
    // .zp2-l 标签样式（innerHTML 里 class 方式比每处内联省字）
    const styleEl = document.createElement('style');
    styleEl.textContent = `.zp2-l{${STYLE_LABEL}}`;
    document.head.appendChild(styleEl);
    document.body.appendChild(box);

    // 档位一键填：只填端点/模型，阈值不动（用户可自行调）
    box.querySelector('#zp2-preset').addEventListener('change', (e) => {
      const p = MODEL_PRESETS[e.target.value];
      if (!p) return;
      box.querySelector('#zp2-endpoint').value = p.endpoint;
      box.querySelector('#zp2-model').value = p.model;
      persistPanel();
      logLine(`已填档位「${p.label}」${p.endpoint && p.endpoint.indexOf('127.0.0.1') === -1 ? '（外接端点：CV/JD 会离开本机）' : ''}`);
    });
    // 面板改动即持久化
    box.addEventListener('change', () => persistPanel());
    box.querySelector('#zp2-gen').addEventListener('click', genKeywordsClick);
    box.querySelector('#zp2-start').addEventListener('click', startClicked);
    logLine('✅ 面板就绪：填 CV → 改画像（可选）→ 生成/填关键词 → 开始投递');
    if (!SITE_ADAPTER) logLine('⚠️ 本站点适配器未就绪（未实现或选择器未核对）：只渲染面板，不执行任何页面动作。');
  }

  /** 按 CV 生成关键词：只填输入框待人审——词表持久化发生在用户点「开始投递」时（spec 口径）。 */
  async function genKeywordsClick() {
    persistPanel();
    const l = loadLedger();
    const kws = await generateKeywords(l);
    if (!kws) return; // 失败原因已明示，词表原样不动
    const el = document.getElementById('zp2-kws');
    if (el) el.value = kws.join(', ');
    logLine(`✅ 生成 ${kws.length} 个词已填入词表（待审，点「开始投递」确认后才生效）：${kws.join('、')}`);
  }

  /** 面板 → 账本 settings（改动即持久化）。 */
  function persistPanel() {
    const l = loadLedger();
    const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    l.settings.cv = val('zp2-cv');
    l.settings.persona = {
      direction: val('zp2-direction'),
      scope: val('zp2-scope'),
      role: val('zp2-role'),
      exclusions: val('zp2-exclusions'),
    };
    l.settings.model = {
      endpoint: val('zp2-endpoint'),
      model: val('zp2-model'),
      threshold: Math.max(1, Math.min(10, Number(val('zp2-threshold')) || 7)),
      max_tokens: (l.settings.model && l.settings.model.max_tokens) || DEFAULT_MODEL.max_tokens,
    };
    l.settings.keywords = collectWords(val('zp2-kws'));
    l.settings.target = Math.max(1, Number(val('zp2-target')) || 10);
    saveLedger(l);
  }

  /** 词表解析：逗号/中文逗号/空白分隔，去重去空——没有推荐流伪关键词，没有固定词，就是用户给的词。 */
  function collectWords(str) {
    const seen = {};
    return String(str || '').split(/[,，\s]+/).map((w) => w.trim()).filter((w) => {
      if (!w || seen[w]) return false;
      seen[w] = true;
      return true;
    });
  }

  /** 开始按钮 → 真投确认框（唯一 staging：不可撤回的操作必须过人眼）。 */
  function startClicked() {
    persistPanel();
    const l = loadLedger();
    const kws = l.settings.keywords || [];
    const target = l.settings.target || 10;
    if (!kws.length) { pushLog('⚠️ 先填关键词（逗号分隔）。', 'bad'); return; }
    if (!gateEnabled(gateSettings(l))) { pushLog('⚠️ 先粘贴 CV（门禁关闭时不投递）。', 'bad'); return; }
    const box = document.getElementById('zp2-confirm');
    box.style.display = 'block';
    box.innerHTML = [
      `<div style="margin-bottom:6px"><b>真投确认</b>：将从 ${esc(kws[0])} 等 ${kws.length} 个词逐条判定并沟通，目标 ${target} 条。<br>`,
      `消息发出后<b>不可撤回</b>。确认开始？</div>`,
      `<button id="zp2-confirm-go" style="${STYLE_BTN};background:#d1242f;border-color:#d1242f">确认开始（目标 ${target} 条）</button>`,
      '<button id="zp2-confirm-no" style="margin-top:4px;width:100%;padding:5px;border:1px solid #d0d7de;border-radius:4px;background:#fff;cursor:pointer;font:inherit">取消</button>',
    ].join('');
    box.querySelector('#zp2-confirm-go').addEventListener('click', () => confirmedStart(target, kws));
    box.querySelector('#zp2-confirm-no').addEventListener('click', hideConfirm);
    pushLog(`⏸ 等待确认：目标 ${target} 条，词表 ${kws.length} 个。`);
  }

  function hideConfirm() {
    const box = document.getElementById('zp2-confirm');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  /** 确认后进入投递循环（core/loop）。 */
  function confirmedStart(target, kws) {
    hideConfirm();
    startRun(target, kws);
  }

  /** 面板日志行：core/safety 的环形缓冲是真相源，这里只负责即时可见。 */
  function logLine(msg) {
    const el = document.getElementById('zp2-log');
    if (!el) return;
    const line = document.createElement('div');
    line.textContent = msg;
    el.appendChild(line);
  }
