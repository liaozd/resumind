#!/usr/bin/env node
/**
 * v2 构建器：零依赖拼装。
 *
 * 为什么不引 esbuild/webpack：油猴脚本不需要打包器的 tree-shaking 与压缩——
 * core/config/panel/sites 都是手写片段，共享同一个 IIFE 作用域、按拼装顺序直接互相引用，
 * fs 顺序拼接就够。站点差异（@name/@match/适配器）由 SITES 表注入：
 * core 改动重跑本脚本，两站产物同步生效。
 *
 * 用法：
 *   node src/build.js           # 构建全部站点（适配器文件缺失的站点以占位适配器产出）
 *   node src/build.js zhipin    # 只构建指定站点
 *
 * 产物：release/<site>_batch.user.js —— 测试台与浏览器安装都吃这个文件（先 build 再测）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RELEASE = path.join(ROOT, '..', 'release');
// 版本号唯一来源：面板渲染 ${VERSION}（纪律：没有第二处写死的版本号）。
// v2 重写期用 alpha 版本号；功能收口后转正 2.0.0。
const VERSION = '2.0.0-a1';

const SITES = {
  zhipin: {
    name: 'BOSS直聘 批量沟通（本地账本）',
    description: '关键词 → 本地 LLM 门禁 → 投递：逐条判定 CV×JD 匹配度，达标才沟通。'
      + '默认演练，真投需二次确认。模型与画像全配置化。',
    match: 'https://www.zhipin.com/web/*',
  },
  liepin: {
    name: '猎聘 批量沟通（本地账本）',
    description: '同 BOSS直聘 版，猎聘适配器。选择器未经真页核对前仅支持采集与判定演练，真投通道关闭。',
    match: 'https://www.liepin.com/*',
  },
};

// 拼装顺序 = 依赖顺序：片段共享 IIFE 作用域，后拼的片段可以直接引用先拼片段的顶层 const。
// 缺失的片段告警跳过（对应任务未落地时构建不炸，便于骨架期渐进落地）。
const FRAGMENTS = [
  'core/ledger.js',
  'core/pacing.js',
  'core/safety.js',
  'core/gate.js',
  'core/loop.js',
  'config/profiles.js',
  'config/persona.js',
  'panel/panel.js',
];

function readFragment(rel, siteId) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`⚠️  [${siteId}] 片段缺失，跳过：${rel}（对应任务落地后自动并入）`);
    return '';
  }
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').trimEnd();
}

function build(siteId) {
  const site = SITES[siteId];
  if (!site) throw new Error(`未知站点：${siteId}（可选：${Object.keys(SITES).join('、')}）`);
  const adapterRel = `sites/${siteId}.js`;
  const adapterSrc = readFragment(adapterRel, siteId);
  const adapterMissing = adapterSrc === '';

  const parts = [];
  parts.push(`// ==UserScript==
// @name         ${site.name}
// @namespace    local.resumind.batch
// @version      ${VERSION}
// @description  ${site.description}
// @match        ${site.match}
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * v2 拼装产物——请勿手改：改 src/ 下的片段后重跑 \`node src/build.js\`。
 * 站点：${siteId}；适配器：${adapterRel}${adapterMissing ? '（尚未实现，骨架占位）' : ''}
 */
`);
  parts.push(`(function () {
  'use strict';
  const SITE_ID = ${JSON.stringify(siteId)};
  const VERSION = ${JSON.stringify(VERSION)};
`);
  for (const rel of FRAGMENTS) {
    const src = readFragment(rel, siteId);
    if (src) parts.push(`  // ===== ${rel} =====\n${src}\n`);
  }
  if (adapterMissing) {
    parts.push(`  // ===== 适配器占位（${adapterRel} 未落地） =====
  // spec/site-adapter：选择器未经真页核对前不提供任何页面动作；core 只认接口，占位为 null 时面板明示不可用。
  const SITE_ADAPTER = null;
`);
  } else {
    parts.push(`  // ===== ${adapterRel} =====\n${adapterSrc}\n`);
  }
  parts.push(readFragment('boot.js', siteId));
  parts.push(`
})();`);

  const out = path.join(RELEASE, `${siteId}_batch.user.js`);
  fs.writeFileSync(out, parts.join('\n'));
  console.log(`✅ ${out}（${adapterMissing ? '适配器占位' : '适配器就绪'}）`);
}

const only = process.argv[2];
const targets = only ? [only] : Object.keys(SITES);
fs.mkdirSync(RELEASE, { recursive: true });
for (const t of targets) build(t);
