  // ---------- config/profiles：模型档位预设 ----------
  // spec/apply-pipeline「配置化」：模型端点/名称/阈值全部面板可编辑。预设只是一键填空，
  // 不是硬约束——任何 OpenAI 兼容端点（含 JEV 一类轻量本地模型）填进面板即可用。
  // 外接档明示隐私代价：CV 与 JD 会离开本机；出厂永远默认本地 127.0.0.1（数据不出本机红线）。
  const MODEL_PRESETS = {
    local14b: { label: '本地 14B（16GB 显存）', endpoint: 'http://127.0.0.1:8080', model: 'qwen2.5-14b-instruct' },
    local7b: { label: '本地 7B（8GB 显存）', endpoint: 'http://127.0.0.1:8080', model: 'qwen2.5-7b-instruct' },
    localLite: { label: '本地轻量（CPU/低显存，型号自填）', endpoint: 'http://127.0.0.1:8080', model: '' },
    remote: { label: '外接 OpenAI 兼容端点（数据出本机，慎选）', endpoint: '', model: '' },
  };

  const DEFAULT_MODEL = {
    endpoint: 'http://127.0.0.1:8080',
    model: 'qwen2.5-14b-instruct',
    threshold: 7,     // ≥ 阈值才投递；判定质量不稳时在面板下调
    max_tokens: 320,
  };
