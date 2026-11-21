"""LLM 判定/生成质量的冒烟测试（离线核对，不碰浏览器、不碰账本）。

v2：门禁是「极简 prompt + 画像配置」，生成是「按 CV 生成关键词只填词表待人审」。
用它人审本地模型的两类输出——
  1. 门禁判定：分数是否符合锚点直觉、排除方向是否真拒、缺失项是否说到点上；
  2. 关键词生成：出的词是否符合画像、有没有结构性错配词。
（v0.6.x 的 LLM 复盘在 v2 已删除，无对应人审项。）

画像 = 虚构示例「林晓 · 内容运营」（与 src/config/persona.js 出厂默认一致）。
prompt 同步纪律：本文件的 judge / gen_keywords 两段 prompt 分别与
src/core/gate.js 的 buildGateMessages / buildGenMessages 逐字一致——
改任何一处 MUST 同步另一处，两文件间无共享代码，只能靠人肉对齐。

跑法：
  cd <repo根>
  python3 llm/smoke_test.py                      # 需要 requests（pip install requests）
  ENDPOINT=http://127.0.0.1:8081 python3 llm/smoke_test.py   # 换端口
  MODEL=qwen2.5-7b-instruct python3 llm/smoke_test.py        # 换模型（轻量档人审重点看分数分布）
"""

import json
import os
import time

import requests

ENDPOINT = os.getenv("ENDPOINT", "http://127.0.0.1:8080")
MODEL = os.getenv("MODEL", "qwen2.5-14b-instruct")
CV_PATH = os.path.join(os.path.dirname(__file__), "..", "cv", "CV.md")

# 与 src/config/persona.js 的 DEFAULT_PERSONA / personaBlock 逐字一致（同步纪律见 docstring）
DEFAULT_PERSONA = {
    "direction": "内容运营、新媒体运营、用户增长",
    "scope": "只做品牌内容/自有账号矩阵侧，不做纯投放买量侧",
    "role": "一线内容执行与策略岗，适配资深内容运营/内容负责人岗",
    "exclusions": "纯直播带货、电话销售、地推、微商加盟类岗位；纯投放买量/货架电商运营",
}


def persona_block(p=None):
    q = p or DEFAULT_PERSONA
    return "\n".join([
        "## 求职方向（匹配度评估的坐标系）",
        f"- 目标方向：{q['direction']}",
        f"- 岗位形态限定：{q['scope']}",
        f"- 求职意向：{q['role']}；资历写实：N 年经验、学历、代表作品",
        f"- 明确排除（落入给 0-3 分并写进理由）：{q['exclusions']}",
    ])


# 门禁判定样例：期望分数仅供人审参照，不是硬断言——判定质量本来就是要人看过才算数。
# 画像为虚构示例（cv/CV.example.md），换自己的 CV 后人审重校准。
# 样例覆盖：对口正例 / 排除方向硬拒 / 领域错配 / 实质缺口 5-6 / 年龄明文上限（v2 无独立年龄规则段——
# 模型如何处理要人看，若分数偏高用户应在画像排除项里写明）/ 资深向 / 英语满足项。
SAMPLES = [
    {
        "title": "新媒体内容运营（小红书/抖音）",
        "company": "某消费品牌公司",
        "salary": "15-25K",
        "desc": "负责品牌自有账号的内容运营与增长。要求：3 年以上内容运营经验，熟悉小红书、抖音平台"
                "机制与违禁词边界，有从 0 到 1 起号案例，会数据复盘（完播率/互动率/涨粉成本），有爆款案例优先。",
        "expect": "9-10（对口 + 简历有直接证据：50w 粉账号与联名 campaign）",
    },
    {
        "title": "带货主播（直播销售）",
        "company": "某电商直播公司",
        "salary": "20-40K",
        "desc": "负责直播间商品讲解与带货转化。要求：普通话标准，镜头表现力强，能接受大促期间"
                "高强度排班；薪资结构为底薪+提成。不接受纯内容运营背景转岗。",
        "expect": "0-3（硬拒：画像明文排除的纯销售转化岗）",
    },
    {
        "title": "电话销售专员",
        "company": "某金融服务公司",
        "salary": "10-20K",
        "desc": "负责电销渠道的客户开发与产品推荐。要求：沟通表达出色，抗压能力强，"
                "有电话销售或地推经验优先，底薪+提成上不封顶。",
        "expect": "0-3（硬拒：领域/工种错配）",
    },
    {
        "title": "信息流广告投放优化师",
        "company": "某广告代理公司",
        "salary": "30-50K",
        "desc": "负责客户信息流广告的投放策划与优化。要求：精通抖音信息流/千川投放，"
                "熟悉 ROI 归因与素材 A/B 测试，有大规模预算操盘经验，数据分析能力扎实，"
                "需独立向客户汇报投放报表。内容制作仅零星参与。",
        "expect": "0-3（硬拒：画像排除的纯投放买量方向，核心技能零命中）",
    },
    {
        "title": "内容运营专员（年轻团队）",
        "company": "某电商公司",
        "salary": "15-25K",
        "desc": "负责品牌账号日常内容产出与评论区运营。要求：3 年以上内容运营经验，熟悉小红书/抖音。"
                "团队年轻有活力，限 35 岁以下，欢迎应届生与我们一起成长。",
        "expect": "低分（人审重点：v2 无独立年龄规则段——35 岁以下明文上限靠模型自己识别，"
                  "若分数偏高应在画像排除项里写明，如「排除明文年龄上限岗」）",
    },
    {
        "title": "资深内容专家（品牌内容中台）",
        "company": "某品牌集团公司",
        "salary": "45-70K",
        "desc": "负责品牌内容中台的内容策略与矩阵规划。要求：10 年以上内容运营经验，"
                "有从策略到落地的全链路交付经验，能独立完成账号体系搭建，内容产出仍为核心职责。欢迎资深运营加盟。",
        "expect": "9-10（资深向：经验要求是资产，职级措辞与资历匹配）",
    },
    {
        "title": "电商内容运营（货架+内容双场域）",
        "company": "某电商平台公司",
        "salary": "25-40K",
        "tags": "5-10年 本科",
        "desc": "负责平台商家账号的内容运营与货架场域配合。要求：内容运营熟练，"
                "熟悉选题策划与数据复盘，有电商大促内容排期经验；熟悉货架运营优先但非必须。"
                "行业处于早期，看重内容能力而非行业背景。",
        "expect": "7-8 以上（内容为核心、电商只是场景；「货架优先非必须」不构成硬门槛）",
    },
    {
        "title": "直播运营负责人",
        "company": "某直播电商公司",
        "salary": "40-70K",
        "desc": "负责直播间全案运营与团队管理。要求：5 年以上直播全案操盘经验，"
                "有大促活动从策划到复盘的完整操盘记录，熟悉主播孵化与直播间投流；"
                "具备千万级 GMV 大促案例者优先。内容策划用于直播间脚本，核心是大促全案与团队管理。",
        "expect": "5-6（方向相关但核心的直播全案/大促操盘经验是简历实质缺口）",
    },
    {
        "title": "品牌客户经理（内容侧支持）",
        "company": "某广告代理公司",
        "salary": "35-55K",
        "desc": "负责重点品牌的广告投放客户对接与方案支持：理解客户诉求、输出内容合作方案、"
                "主导客户提案与比稿演示、协同销售完成签约。要求：懂内容运营逻辑（有内容背景优先），"
                "沟通表达出色，能独立面对客户高管；以客户支持与商务对接为核心职责，非内容产出岗。",
        "expect": "3-5（职类错配：核心职责商务对接、明文非内容产出岗）",
    },
    {
        "title": "资深新媒体运营（品牌内容）",
        "company": "某消费品牌公司",
        "salary": "30-50K",
        "desc": "负责品牌新媒体账号的内容策略与产出：选题策划、脚本统筹、数据复盘、跨平台分发；"
                "带 3 人内容小组（80% 精力在内容本身）。要求：内容运营精通，有爆款案例与完整账号交付经验，"
                "独立负责过从 0 到 1 起号。",
        "expect": "9-10（带人是加分不是核心职责，方向/能力/直接证据全对口）",
    },
    {
        "title": "海外内容运营（出海团队）",
        "company": "某出海科技公司",
        "salary": "30-50K",
        "desc": "负责面向海外市场的内容账号运营：多平台内容策划、英文脚本与评论区互动、"
                "本地化选题与数据复盘。要求：内容运营精通，有账号增长案例；英语可作为工作语言"
                "（团队含海外成员，日常英文沟通与素材调研），读写能干活即可。一线内容岗。",
        "expect": "9-10（简历写明英语可工作语言，按简历如实判断——JD 的英语要求是满足项）",
    },
    {
        "title": "内容运营（国际化业务）",
        "company": "某互联网公司",
        "salary": "25-40K",
        "desc": "负责国际化业务线的内容运营：多语言内容选题与本地化，英文素材调研与竞品追踪，"
                "与海外办公室异步协作。核心职责为账号内容产出与增长。",
        "expect": "7-8 以上且 missing 不含英语项（简历已写英语能力，按简历如实对照）",
    },
]


def load_cv():
    with open(CV_PATH, encoding="utf-8") as fh:
        return fh.read().strip()


def chat(client, sys, user, max_tokens, temperature=0.1):
    t0 = time.time()
    resp = client.post(
        f"{ENDPOINT}/v1/chat/completions",
        json={
            "model": MODEL,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        },
        timeout=180,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"]
    return text, time.time() - t0


def json_block(text):
    # 解析逻辑与 userscript 的 parseVerdict/parseKeywordList 保持一致：剥围栏、截首个大括号块
    s = text.replace("```json", "").replace("```", "")
    for marker in ("```JSON", "```"):
        s = s.replace(marker, "")
    i, j = s.find("{"), s.rfind("}")
    return json.loads(s[i:j + 1])


def judge(client, cv, job):
    # 与 src/core/gate.js 的 buildGateMessages 逐字一致（同步纪律见 docstring）
    sys = "你是严谨的求职匹配评估器。只输出一个 JSON 对象，不要任何其他文字、解释或代码块标记。"
    user = "\n".join([
        "## 求职者简历",
        cv,
        "",
        persona_block(),
        "",
        "## 职位",
        f"标题：{job['title']}",
        f"公司：{job.get('company', '未知')}",
        f"薪资：{job['salary']}",
        "职位描述：",
        job["desc"],
        "",
        "## 任务",
        "从专业能力、经验、学历、领域背景评估该求职者与职位的匹配度，打 0-10 分。",
        "锚点：9-10 = 方向对口、核心要求全满足、简历中有直接证据；7-8 = 对口、个别次要要求缺失（写入 missing）；5-6 = 方向相关但存在实质缺口；0-4 = 硬拒（明文排除方向、核心技能完全缺失、经验学历明显差档）。",
        '只输出 JSON：{"score": <0-10 的整数>, "reason": "<一句话理由>", "missing": ["<缺失的关键要求>"]}',
    ])
    text, dt = chat(client, sys, user, 320)
    return json_block(text), dt


def gen_keywords(client, cv):
    # 与 src/core/gate.js 的 buildGenMessages 逐字一致（同步纪律见 docstring）
    sys = "你是求职搜索词规划器。只输出一个 JSON 对象，不要任何其他文字、解释或代码块标记。"
    user = "\n".join([
        "## 求职者简历",
        cv,
        "",
        persona_block(),
        "",
        "## 任务",
        "按上面的简历与求职方向生成 5~10 个求职网站的搜索关键词：职能/平台/技能词，2~8 个字，不要长组合词。",
        '只输出 JSON：{"keywords": ["词1", "词2", ...]}',
    ])
    text, dt = chat(client, sys, user, 500, temperature=0.3)
    return json_block(text), dt


def main():
    try:
        cv = load_cv()
    except FileNotFoundError:
        raise SystemExit(f"❌ 找不到 {os.path.normpath(CV_PATH)}——复制 cv/CV.example.md 为 CV.md 填入你的简历再跑。")
    if not cv:
        raise SystemExit("❌ CV.md 是空的，先填简历。")

    client = requests.Session()
    try:
        health = client.get(f"{ENDPOINT}/health", timeout=5)
        health.raise_for_status()
    except Exception as exc:
        raise SystemExit(f"❌ LLM 服务不在 {ENDPOINT}（{exc}）。先跑 llm/serve.sh。")

    print(f"服务在线：{ENDPOINT} ｜ 模型：{MODEL} ｜ CV：{len(cv)} 字符 ｜ 判定样例 {len(SAMPLES)} 条 + 生成用例 1\n")

    print("=" * 30, "1/2 门禁判定（人审重点：排除方向必拒、按简历如实判断（prompt 无画像特质指令）、年龄明文上限的模型表现）", "=" * 30)
    for idx, job in enumerate(SAMPLES, 1):
        v, dt = judge(client, cv, job)
        flag = "✅ 高分" if v.get("score", 0) >= 7 else "✋ 低分"
        print(f"[{idx}] {job['title']} ｜ {job['salary']}")
        print(f"    {flag} ｜ {v.get('score')} 分 ｜ {dt:.1f}s ｜ 期望：{job['expect']}")
        print(f"    理由：{v.get('reason', '')}")
        if v.get("missing"):
            print(f"    缺失：{'、'.join(v['missing'])}")
        print()

    print("=" * 30, "2/2 关键词生成（人审重点：符合画像、无带货主播/电话销售类错配词）", "=" * 30)
    gen, dt = gen_keywords(client, cv)
    print(f"关键词（{dt:.1f}s）：{'、'.join(gen.get('keywords', []))}")
    print()
    print("两段输出都要人审：判定分数是否符合锚点、生成词的画像符合度。")
    print("有任何一处不对，先改 CV 措辞或对应 prompt（src/core/gate.js 与本文件两处同步），再上真实投递。")


if __name__ == "__main__":
    main()
