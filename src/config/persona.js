  // ---------- config/persona：画像配置 → prompt 片段 ----------
  // spec/apply-pipeline「配置化」：画像面板可编辑并持久化（settings.persona），判定 prompt 由
  // 静态模板 + 画像字段直出——v0.6.x「三段 prompt 两文件人肉同步」的整套纪律在本版消失。
  // 出厂默认 = 虚构示例画像（林晓 · 内容运营），承接 sanitize-personal-data 的开源脱敏成果。
  // **画像只携带事实字段（方向/形态/意向/排除）**：判定行为完全按简历如实对照 JD——
  // prompt 里不得出现预设简历特质的指令（如「英语是满足项 MUST NOT 写进 missing」——
  // 那是替有英语能力的人写的，换成没有的人会错误压制 missing）。英语等能力写进 CV 即可。
  const DEFAULT_PERSONA = {
    direction: '内容运营、新媒体运营、用户增长',
    scope: '只做品牌内容/自有账号矩阵侧，不做纯投放买量侧',
    role: '一线内容执行与策略岗，适配资深内容运营/内容负责人岗',
    exclusions: '纯直播带货、电话销售、地推、微商加盟类岗位；纯投放买量/货架电商运营',
  };

  /** 画像 → prompt 片段：排除项按硬拒锚点计（0-3）。 */
  function personaBlock(p) {
    const q = p || DEFAULT_PERSONA;
    return [
      '## 求职方向（匹配度评估的坐标系）',
      `- 目标方向：${q.direction}`,
      `- 岗位形态限定：${q.scope}`,
      `- 求职意向：${q.role}；资历写实：N 年经验、学历、代表作品`,
      `- 明确排除（落入给 0-3 分并写进理由）：${q.exclusions}`,
    ].join('\n');
  }

  /** settings.persona 容错合并：缺字段回落出厂默认（用户只改了方向也不丢其余字段）。 */
  function effectivePersona(raw) {
    const merged = {};
    Object.keys(DEFAULT_PERSONA).forEach((k) => {
      merged[k] = (raw && typeof raw[k] === 'string' && raw[k].trim()) ? raw[k] : DEFAULT_PERSONA[k];
    });
    return merged;
  }
