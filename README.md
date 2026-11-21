# Resumind

**跑在你自己浏览器里的求职筛选与批量沟通工具：关键词 → 本地大模型判定 → 达标才投。**

v2 一条直线：粘贴 CV 与画像 → 生成/手输关键词 → 逐条判定 → 达标投递。没有词表工程、没有探索闭环、没有复盘看板——那些机制在 v0.6.x 里滚到 17 项之后被整体砍掉（为什么砍，见文末「为什么简单」）。

当前支持 BOSS直聘；猎聘适配器需要先真页核对选择器（见 `docs/liepin-checklist.md`），核对通过前只提供采集与判定演练。

```
粘贴 CV + 画像（面板）
   ↓
生成 / 手输关键词 —— 生成的词只填词表待人审，确认后才生效
   ↓
逐词搜索 → 逐条：归属校验 → 抓 JD → 本地 LLM 打分
   ↓                        ↓
≥ 阈值 → 占位 → 确认 → 投    < 阈值 → 下一条
   ↓
随机节奏 + 撞风控词停手 + 连续失败熔断
```

## 它解决什么问题

批量投递工具的通病是无差别海投。这个项目把「该不该投」交给**跑在你自己 GPU 上的本地模型**——CV×JD 逐条打分，低于阈值自动跳过。判定数据全部留在本机。

## 核心机制

- **本地 LLM 门禁**：极简 prompt（~20 行，轻量小模型可执行），输出 分数/理由/缺失；**判不了 ≠ 放行**——服务离线或输出不可解析一律计失败，连续 5 次熔断
- **关键词生成**：CV + 画像 → 本地端点出 5~10 个词，只填词表待人审
- **安全闸门**：真投二次确认、占位防重发、点击前按钮归属校验（轮询）、一次页面加载只投一条、风控文案停手、日志跨页存续
- **配置化**：模型端点/名称/阈值与画像（方向/排除项/职类/英语档）全部面板可编辑并持久化；判定 prompt 由模板 + 画像直出
- **双站适配器**：core 不含任何站点选择器；BOSS直聘适配器从 v0.6.x 实测纪律提炼，猎聘待真页核对

## 模型档位（面板一键填）

| 档位 | 模型 | 硬件 | 说明 |
|---|---|---|---|
| 本地 14B（默认） | Qwen2.5-14B Q4_K_M | 16GB 显存 | 质量优先 |
| 本地 7B | Qwen2.5-7B Q4_K_M | 8GB 显存 | `./download_model.sh 7b` |
| 本地轻量 | 自填型号 | CPU / 4GB | JEV 一类小模型；prompt 已按小模型设计，阈值可在面板下调 |
| 外接端点 | 任何 OpenAI 兼容 | 无本机 GPU | **CV/JD 会离开本机**，面板明示警示 |

## 快速开始

### 1. 构建 & 安装脚本

```bash
node src/build.js          # 产出 release/zhipin_batch.user.js（改源码后重跑）
```

Chrome 装 [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)，把 `release/zhipin_batch.user.js` 拖进浏览器安装。登录求职网站后打开搜索结果页，右上角出现面板。

### 2. 起本地 LLM 服务

```bash
cd llm
./download_model.sh        # 14B（默认）；7b：./download_model.sh 7b
./serve.sh -d              # Docker 起 llama.cpp，只绑 127.0.0.1:8080
./serve.sh -m /path/to/model.gguf -d   # 轻量自填；或用 Ollama 起服务后面板改端点
```

需要 NVIDIA GPU；无 GPU 用「本地轻量」档（CPU 可跑小模型）或外接端点。

### 3. 面板配置

粘贴 CV（markdown，结构参考 `cv/CV.example.md`：**匹配要点段前置**）→ 改画像排除项（可选）→ 点「按 CV 生成关键词」或手输 → 「开始投递」→ 真投确认框。

### 4. 判定质量人审（上真投前）

```bash
python3 llm/smoke_test.py   # 12 条样例 JD 人审模型判定方向（需 requests）
```

## 测试

安全闸门测试台（jsdom，测 release 产物，10 组场景 / 63 断言）：

```bash
node src/build.js
NODE_PATH=/tmp/zp-test/node_modules node src/test_batch_userscript.js
```

覆盖：误投防护（归属校验/占位幂等/熔断/风控停手）、门禁语义（阈值边界/离线不放行/输出不可解析）、配置（画像注入/模型切换）、关键词生成（只填待人审/失败不动）、站点识别。

## 目录结构

```
src/build.js            零依赖拼装：core+config+panel+sites → release/<site>_batch.user.js
src/core/               平台无关：ledger（去重/占位）、gate（判定）、pacing、safety（熔断/停手/日志）、loop（投递循环）
src/config/             模型档位预设 + 画像 → prompt 生成
src/panel/              面板（配置区/词表/目标/确认框/日志）
src/sites/              站点适配器（zhipin；liepin 待真页核对）
src/test_batch_userscript.js  jsdom 测试台（测 release 产物）
llm/                    download_model.sh / serve.sh（档位化）/ smoke_test.py（判定质量人审通道）
cv/CV.example.md        CV 结构模板（虚构示例画像）
docs/liepin-checklist.md  猎聘适配前的真页核对清单
```

## 设计原则（红线，v2 继续有效）

- **不绕风控、不伪装指纹**：所有自动化跑在真实登录会话里；撞到平台提示立即停手交人工。账号安全比投递量值钱。
- **不可逆操作必须人工确认**：真投前二次确认；一次页面加载只投一条。
- **判不了 ≠ 放行**：LLM 离线、输出不可解析、JD 抓不到——计失败并熔断，绝不静默跳过门禁。
- **判定数据不出本机**：CV 与 JD 只进本地推理服务（外接端点需显式选择并明示警示）。

## 为什么简单（v0.6.x 的教训摘要）

v0.6.x 在 24 个版本里长出了 17 项机制：推荐流伪关键词、词表环绕循环、每词配额、词内分页遍历、薪资批次互斥、游标续跑、固定词、探针、自动探索、迷你探索、生成词退场记账、记忆环、LLM 复盘、复盘统计、HR 回填、拒判版本戳重验、演练/试判两阶段。每一项都对应一次真实事故，但叠在一起后：判定 prompt 30+ 行只有 14B 级模型能跟住、2274 行单文件无法加第二个站点、每次投递前用户要在面板里理解 6 个概念。

v2 的取舍：**搜索词本身就是过滤器**（搜「内容运营」召回的就是内容岗），确定性预过滤、词表工程、探索闭环全部不需要；pacing、熔断、占位、归属校验这些「防误发」底线全部保留。被删机制的事故教训浓缩在 `src/sites/zhipin.js` 与 `src/core/` 的注释里，别在没读懂它们之前加回来。

## License

MIT
