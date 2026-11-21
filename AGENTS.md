# AGENTS.md

Resumind v2：跑在用户浏览器里的求职筛选与批量沟通工具（BOSS直聘已支持，猎聘适配中）。一条直线流程：关键词 → 本地 LLM 门禁 → 达标投递。本地 LLM（llama.cpp/Ollama，OpenAI 兼容端点全配置化）做判定，判定数据不出本机。

## 架构与改代码前必读

```
src/build.js            零依赖拼装器 → release/<site>_batch.user.js
src/core/               平台无关：ledger / gate / pacing / safety / loop（不含任何站点选择器）
src/config/             模型档位预设 + 画像 → prompt 直出
src/panel/              面板
src/sites/              站点适配器（zhipin 已实现；liepin 待真页核对）
src/test_batch_userscript.js  jsdom 测试台（测 release 产物，不是测源片段）
```

**铁律：release/ 是拼装产物（已 gitignore），禁止手改**——改 `src/` 片段后 `node src/build.js` 重拼；测试与安装都吃 release。

- **core/adapter 边界**（spec：site-adapter）：投递循环、门禁、节奏、熔断不含选择器/URL 语法；站点差异全部收敛在 `src/sites/<site>.js`。适配器必须实现：jobId / listCards / selectCard / validateOwnership（轮询）/ scrapeJd（thin/missing 分流）/ chatButton / searchUrl / riskOverlay。
- **选择器真页验证纪律**：任何站点的选择器未经真实登录页人工核对，真投通道不得启用（猎聘当前仅采集+演练）。核对清单：`docs/liepin-checklist.md`。
- **纪律分家**：v0.6.x 的 23 条纪律已按归属拆进代码注释——账号安全类（判不了≠放行、一次一投、占位防重发、PACE 唯一节奏旋钮禁写 literal 毫秒、熔断、长呼吸、会话上限）在 `src/core/` 各文件头；站点行为类（ka 轮询 25 秒、卡片漂移、路径单复数、JD 三支状态）在 `src/sites/zhipin.js` 头部。改行为先读对应注释。

## Prompt 同步纪律（最容易漏）

两段 prompt 在 `src/core/gate.js`（buildGateMessages / buildGenMessages）与 `llm/smoke_test.py`（judge / gen_keywords）各一份，无共享代码只能人肉对齐；`src/config/persona.js` 的 DEFAULT_PERSONA/personaBlock 与 `llm/smoke_test.py` 的 DEFAULT_PERSONA/persona_block 也必须一致。**改任何一处 MUST 同步另一处**，然后跑 `python3 llm/smoke_test.py` 人审。

## 测试（唯一自动化闸门）

```bash
node src/build.js
NODE_PATH=/tmp/zp-test/node_modules node src/test_batch_userscript.js
```

jsdom 是故意不进仓库的测试依赖（无 package.json）。测试台测 release 产物、按页驱动模拟导航（`navigate()` 在 jsdom 是空操作，断言走 `window.__zp2.lastNav`）。已知语义：`__ZP_PACE__: 0` 是合法测试档位（pacing 用 nullish 判定，不能用 `|| 2`——0 是 falsy，曾把测试静默拖进慢档）。

## 出厂内容全是虚构示例

「林晓 · 内容运营（杭州）」贯穿：cv/CV.example.md、config/persona.js 出厂画像、llm/smoke_test.py 样例。用户在面板改成自己的画像即可；**不要在出厂值里写回任何真实个人信息**。个人数据绝不入库：`cv/CV.md`、`data/`（含 v0.6.x→v2 的个人备份）、`*.db`、`llm/models/`（见 .gitignore）。

## 其他

- `llm/serve.sh -h` / `download_model.sh` 有档位说明（14b/7b/custom 自填——JEV 一类轻量模型走自填或 Ollama 外接）。
- 面板版本号走 `${VERSION}`（build.js 注入，唯一来源），别在第二处写死。
- OpenSpec 工作流：活跃 change 在 `openspec/changes/`；openspec-* 技能在 `.agents/skills/`。
- 不主动 commit/push——等用户明示。
