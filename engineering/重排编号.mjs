/* ============================================================
   engineering/重排编号.mjs —— 把主线编号重新摊开为 010 / 020 / 030 …
   用法：node engineering/重排编号.mjs            直接执行（保序重排，改完自动提示重跑拼合与校验）
         node engineering/重排编号.mjs --dry      只预览，不动文件
         node engineering/重排编号.mjs --step=10  指定步长（默认 5）
   为什么需要它：编号是「声明序 = 学习主线」，为便于插卡而留了步长的空隙。
   空隙总有用尽的一天，那时用本脚本一键恢复空隙——**保序**，且编号不显示、互链走 id，
   所以重排不改变任何内容与引用关系，只改文件名前缀与卡内 `## N.`。
   步长口径（2026-10-02 起，见 content/词条清单.md §一）：**基础步长 5**，容量 = 三位数 ÷ 5 = 200 项；
   现有编号多是 10 的倍数，属 5 的合法子集，故不传参数的老用法结果不变。
   英文分册镜像中文分册的编号（按 id 对齐），不单独排序。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseKnowledgeDir, entryToMd } from './lib-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [path.join(ROOT, 'content', '知识库'), path.join(ROOT, 'content', '知识库-en')];
const dry = process.argv.includes('--dry');
/* 步长：默认 5（2026-10-02 口径，见 content/词条清单.md §一），可用 --step=N 覆盖；
   现有编号多为 10 的倍数，仍属 5 的合法子集，不重排时一条都不用改 */
const STEP = Number((process.argv.find(a => a.startsWith('--step=')) || '').split('=')[1]) || 5;

const cn = parseKnowledgeDir(DIRS[0], { keepMeta: true });
const numOf = {};                       /* 中文分册定编号；英文分册按 id 镜像同一编号 */
cn.forEach((t, i) => { numOf[t.id] = (i + 1) * STEP; });

/* ---- 先算出全部改动，确认无冲突再落盘 ---- */
const plans = DIRS.map((dir, k) => {
  const terms = k === 0 ? cn
    : parseKnowledgeDir(dir, { optional: true, allowStageLess: true, keepMeta: true });
  return terms.map(t => {
    const seq = numOf[t.id] || t.__seq;
    const from = path.join(dir, t.__file);
    const to = path.join(path.dirname(from), String(seq).padStart(3, '0') + '-' + t.id + '.md');
    return { term: t, seq: seq, from: from, to: to };
  });
});
const all = plans.flat();
const changes = all.filter(p => p.from !== p.to);
const sources = new Set(all.map(p => p.from));
const targets = new Set();
for (const p of changes){
  const key = p.to.toLowerCase();
  if (targets.has(key)) throw new Error('目标文件名冲突：' + path.relative(ROOT, p.to));
  targets.add(key);
  if (fs.existsSync(p.to) && !sources.has(p.to)) throw new Error('目标文件已存在且不属于本次重排：' + path.relative(ROOT, p.to));
}

console.log('中文 ' + cn.length + ' 条；需要改动的卡片：' + changes.length + ' 张');
changes.forEach(p => console.log('   ' + path.relative(ROOT, p.from) + '\n   → ' + path.relative(ROOT, p.to)));
if (!changes.length){ console.log('编号已是 010/020/… 形态，无需重排。'); process.exit(0); }
if (dry){ console.log('\n（--dry 预览模式，未改动任何文件）'); process.exit(0); }

/* ---- 落盘：先写新文件，再删旧文件（中途失败也不丢内容） ---- */
for (const p of changes){
  fs.writeFileSync(p.to, entryToMd(p.term, p.seq), 'utf8');
  fs.unlinkSync(p.from);
}
console.log('\n已重排 ' + changes.length + ' 张卡片。接着跑：\n   node engineering/拼合.mjs\n   node engineering/校验.mjs');
