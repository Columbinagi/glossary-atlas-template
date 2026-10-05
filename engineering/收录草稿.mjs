/* ============================================================
   engineering/收录草稿.mjs —— 把「审阅通过」的卡片草稿收录进知识库，并重建站点
   用法：node engineering/收录草稿.mjs <草稿文件> [--en] [--num=NNN] [--dry]
   例：  node engineering/收录草稿.mjs content/草稿/motor-controller-mcu.md
         node engineering/收录草稿.mjs content/草稿/motor-controller-mcu.md --num=165   （插到 160 与 170 之间）
         node engineering/收录草稿.mjs content/草稿/pmsm-en.md --en                     （英文译文卡）
   做四件事：① 解析并校验草稿 ② 分配主线编号 ③ 写入 知识库/<主题名>/ 并删除草稿 ④ 重建站点
   收尾仍要跑 `node engineering/校验.mjs`：0 错误才算收录完成（本脚本只做文件搬运与编号，不做内容判断）。
   草稿区（content/草稿/）不被拼合读取，所以没审阅通过的草稿不会污染站点。
   ============================================================ */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseKnowledgeDir, entryToMd } from './lib-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STEP = 5;                                    /* 编号步长 5（2026-10-02 口径，容量 99→200，与 内容规范 §5 / 词条清单 §一 一致）：留空隙，方便日后插卡 */

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const en = args.includes('--en');
const numArg = (args.find(a => a.startsWith('--num=')) || '').slice(6);
const draftArg = args.find(a => !a.startsWith('--'));
const fail = msg => { console.log('✗ ' + msg); process.exit(1); };

if (!draftArg) fail('用法：node engineering/收录草稿.mjs <草稿文件> [--en] [--num=NNN] [--dry]');
const draft = path.isAbsolute(draftArg) ? draftArg : path.join(ROOT, draftArg);
if (!fs.existsSync(draft) || !fs.statSync(draft).isFile()) fail('草稿文件不存在：' + draftArg);

const KB = path.join(ROOT, 'content', en ? '知识库-en' : '知识库');

/* ---- 站点配置：主题 id → 主题名（目录名） ---- */
const cfgRaw = fs.readFileSync(path.join(ROOT, 'content', '站点配置.js'), 'utf8');
const mark = cfgRaw.indexOf('↑↑↑↑↑↑');             /* 收尾标记在注释里，切到该行之前，避免带上未闭合的注释符 */
const cfg = cfgRaw.slice(cfgRaw.indexOf('*/', cfgRaw.indexOf('↓↓↓↓↓↓')) + 2, cfgRaw.lastIndexOf('\n', mark));
const { TOPICS, CATEGORIES } = new Function(cfg + '\nreturn {TOPICS: TOPICS, CATEGORIES: CATEGORIES};')();

/* ---- ① 解析并校验草稿（复制到临时目录，复用正式解析器，避免两套格式判断） ---- */
const tmp = path.join(os.tmpdir(), 'kb-draft-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(draft, path.join(tmp, path.basename(draft)));
let term = null;
try {
  const parsed = parseKnowledgeDir(tmp, { optional: true, allowStageLess: en });
  if (parsed.length !== 1) fail('一张草稿文件里应当只有一张卡片，实际解析出 ' + parsed.length + ' 张');
  term = parsed[0];
} catch (e){
  fail('草稿解析失败（格式不符契约）：' + e.message);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const problems = [];
if (!/^[a-z0-9-]+$/.test(term.id || '')) problems.push('id 只允许小写字母/数字/连字符，当前为 ' + term.id);
if (!term.name) problems.push('缺词条名');
if (!term.definition) problems.push('缺「是什么」（必填字段）');
if (!term.topic && !term.cat) problems.push('缺「主题」或「分类」，无法归属目录');

const cnTerms = parseKnowledgeDir(path.join(ROOT, 'content', '知识库'), { keepMeta: true });
const enTerms = parseKnowledgeDir(path.join(ROOT, 'content', '知识库-en'),
  { optional: true, allowStageLess: true, keepMeta: true });
if (en){
  if (!cnTerms.some(t => t.id === term.id)) problems.push('英文卡必须已有同 id 的中文卡：' + term.id);
} else if (cnTerms.some(t => t.id === term.id)){
  problems.push('id 与已收录词条撞车：' + term.id);
}
if (enTerms.some(t => t.id === term.id)) problems.push('该 id 的英文卡已存在：' + term.id);
if (problems.length) fail('草稿校验未通过：\n   - ' + problems.join('\n   - '));

/* ---- ② 分配主线编号：中文卡取「现有最大编号 + 步长」；英文卡镜像中文卡的编号 ---- */
function topicNameOf(t){
  let id = t.topic;
  if (!id && t.cat){
    const c = CATEGORIES.find(x => x.id === t.cat);
    id = c && c.topic;
  }
  const tp = TOPICS.find(x => x.id === id);
  if (!tp) fail('主题无法归属（topic=' + t.topic + ' cat=' + t.cat + '）——请检查 站点配置.js');
  return tp.name;
}
const seqs = cnTerms.map(t => t.__seq);
let seq;
if (en) seq = (cnTerms.find(t => t.id === term.id) || {}).__seq;
else if (numArg) seq = parseInt(numArg, 10);
else seq = (seqs.length ? Math.max.apply(null, seqs) : 0) + STEP;
if (!seq || seq <= 0) fail('编号无法确定（--num=NNN 需为正整数）');
if (seqs.indexOf(seq) >= 0) fail('编号 ' + seq + ' 已被占用（现有：' + seqs.join(', ') + '）');
/* 编号决定主线序：给出落在哪两张卡之间，便于人工确认位置对不对 */
const lower = cnTerms.filter(t => t.__seq < seq).pop();
const upper = cnTerms.filter(t => t.__seq > seq)[0];
const pos = (lower ? '排在「' + lower.name + '」之后' : '排在最前') + (upper ? '、「' + upper.name + '」之前' : '、排在最后');

/* ---- ③ 写入知识库并删除草稿 ---- */
const dir = path.join(KB, topicNameOf(term));
const num = String(seq).padStart(3, '0');
const target = path.join(dir, num + '-' + term.id + '.md');
console.log('草稿：' + path.relative(ROOT, draft));
console.log('收录：' + path.relative(ROOT, target) + '（编号 ' + num + '，' + pos + '）');
if (dry){ console.log('\n（--dry 预览模式，未改动任何文件）'); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(target, entryToMd(term, seq), 'utf8');   /* 用序列化器重写，顺带把格式统一成规范形 */
fs.unlinkSync(draft);

/* ---- ④ 重建站点（校验留给调用方跑：0 错误才算完成）
   2026-09-25：spawnSync 子进程在 WorkBuddy 环境被拦（EBUSY，见 MEMORY §23），改为进程内
   动态 import 拼合脚本——同一份 拼合.mjs 顶层逻辑在本进程执行，输出与失败语义不变 */
let mergeErr = null;
try { await import(pathToFileURL(path.join(ROOT, 'engineering', '拼合.mjs')).href); }
catch (e) { mergeErr = e; }
if (mergeErr){ console.error((mergeErr && mergeErr.stack) || String(mergeErr)); fail('拼合失败，请检查上面的输出'); }
console.log('已收录「' + term.name + '」并重建站点。接着跑：\n   node engineering/校验.mjs');
