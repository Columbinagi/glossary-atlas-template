/* ============================================================
   engineering/lib-md.mjs —— 知识库 Markdown ⇄ 结构化词条 的公共库
   parseKnowledgeDir(dir)  → 词条对象数组（权威源：content/知识库/*.md）
   serializeTerms(terms)   → 数据区词条段 js 文本（供拼合生成站点）
   normDeep(v)             → 递归键排序（数据等价比较用）
   约定：`## N. 词条名` 是词条分隔标记；`### 中文节标题` 映射数据契约字段。
   ============================================================ */
import fs from 'fs';
import path from 'path';

export const FIELD_TITLES = {
  '你可能会说': 'scenario',
  '是什么': 'definition',
  '详解': 'defNote',
  '先知道': 'prereqs',
  '别名': 'aliases',
  '图解': 'demo',
  '一句话': 'demoAnswer',
  '演示注解': 'demoNote',
  '主线位置': 'flow',
  '组成结构': 'anatomy',
  '可操作演示': 'demoCtl',
  '正文分点': 'sections',
  '使用场景': 'usage',
  '常见变体': 'variants',
  '典型场景': 'scenes',
  '容易混淆': 'confusions',
  '选择题': 'quiz',
  '告诉 AI': 'aiPrompt',
  '接下来学什么': 'next',
  '来源': 'refs'
};

/* ---------- md 侧 ---------- */

/* 把节内的 ```lang 代码块抽出来，返回 { text: 无代码块的行数组, blocks: [{lang, code, at}] } */
function extractBlocks(lines){
  const text = [], blocks = [];
  let i = 0;
  while (i < lines.length){
    const m = lines[i].match(/^```(\w*)\s*$/);
    if (m === null){ text.push(lines[i]); i++; continue; }
    const lang = m[1] || '';
    const buf = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])){ buf.push(lines[i]); i++; }
    if (i >= lines.length) throw new Error('代码块未闭合：' + buf.join('').slice(0, 60));
    i++;                                  /* 跳过收尾 ``` */
    blocks.push({ lang: lang, code: buf.join('\n'), at: text.length });
  }
  return { text: text, blocks: blocks };
}

/* 把节内容拆成「文本行 / 代码块」交替序列，供 mock 归属等按出现顺序解析 */
function extractSeq(lines){
  const text = [], blocks = [], seq = [];
  let i = 0;
  while (i < lines.length){
    const m = lines[i].match(/^```(\w*)\s*$/);
    if (m === null){ text.push(lines[i]); seq.push({ kind: 'line', s: lines[i] }); i++; continue; }
    const lang = m[1] || '';
    const buf = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])){ buf.push(lines[i]); i++; }
    if (i >= lines.length) throw new Error('代码块未闭合：' + buf.join('').slice(0, 60));
    i++;
    const blk = { lang: lang, code: buf.join('\n'), at: text.length };
    blocks.push(blk);
    seq.push({ kind: 'block', lang: lang, code: blk.code });
  }
  return { text: text, blocks: blocks, seq: seq };
}

/* 递归收集目录下全部 *.md
   遍历顺序 = 目录项名升序，遇到子目录先下钻 —— 同一编号出现多次时，谁先谁后由此决定，可预期。
   子目录名不影响解析：主题归属一律以卡内 `- 主题:` / `- 分类:` 字段为准，不由路径推断。 */
function collectMd(dir){
  const out = [];
  for (const name of fs.readdirSync(dir).sort()){
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...collectMd(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/* 按声明序解析整个知识库目录，返回词条对象数组
   opts.optional：目录不存在/为空时返回 []（英文分册可缺）；默认仍抛错（保护中文分册）
   opts.allowStageLess：允许「组成结构」只写部件行、无舞台图代码块（英文分册用，舞台图沿用中文壳）
   opts.keepMeta：保留 __seq（卡内编号）与 __file（相对路径），供校验/重排编号使用；默认删除
   目录结构：既支持「一册一文件」（全部 md 平铺），也支持「一卡一文件」（按主题分子目录） */
export function parseKnowledgeDir(dir, opts){
  opts = opts || {};
  const files = fs.existsSync(dir) ? collectMd(dir) : [];
  if (!files.length){
    if (opts.optional) return [];
    throw new Error(dir + ' 下没有任何 .md 分册');
  }
  const terms = [];
  for (const full of files){
    const f = path.relative(dir, full);
    const lines = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const starts = [];
    lines.forEach((l, i) => { const m = l.match(/^## (\d+)\. (.+)$/); if (m) starts.push({ i: i, seq: parseInt(m[1], 10), name: m[2] }); });
    if (!starts.length) throw new Error(f + ' 没有任何「## N. 词条名」分隔标记');
    for (let k = 0; k < starts.length; k++){
      const from = starts[k].i;
      const to = k + 1 < starts.length ? starts[k + 1].i : lines.length;
      terms.push(parseEntry(lines.slice(from, to), starts[k], f, opts));
    }
  }
  terms.sort((a, b) => a.__seq - b.__seq);
  if (!opts.keepMeta) for (const t of terms){ delete t.__seq; delete t.__file; }
  return terms;
}

function parseEntry(lines, meta, file, opts){
  const where = file + '「' + meta.name + '」';
  const t = { __seq: meta.seq, id: null, name: meta.name };
  if (opts && opts.keepMeta) t.__file = file;
  /* 元信息列表：到第一个 ### 之前 */
  let headEnd = lines.findIndex(l => /^### /.test(l));
  if (headEnd < 0) headEnd = lines.length;
  for (let i = 0; i < headEnd; i++){
    const m = lines[i].match(/^- (id|主题|分类): `([^`]+)`$/);
    const me = lines[i].match(/^- 英文名: (.+)$/);
    if (!m && !me) continue;
    if (m){
      if (m[1] === 'id') t.id = m[2];
      else if (m[1] === '主题') t.topic = m[2];
      else if (m[1] === '分类') t.cat = m[2];
    } else if (me) t.nameEn = me[1];
  }
  if (!t.id) throw new Error(where + ' 缺 id 元信息');

  /* 节切分 */
  const secs = [];
  for (let i = headEnd; i < lines.length; i++){
    const m = lines[i].match(/^### (.+)$/);
    if (m) secs.push({ title: m[1].trim(), lines: [] });
    else if (secs.length) secs[secs.length - 1].lines.push(lines[i]);
  }
  for (const s of secs){
    const key = FIELD_TITLES[s.title];
    if (!key) throw new Error(where + ' 未识别的分节标题：' + s.title);
    const ex = extractSeq(s.lines);
    const val = parseField(key, ex, where, opts);
    if (val !== undefined) t[key] = val;
  }
  return t;
}

function parseField(key, ex, where, opts){
  const text = ex.text.join('\n');
  const firstBlock = ex.blocks.length ? ex.blocks[0].code : null;
  const bad = msg => { throw new Error(where + '「' + key + '」' + msg); };
  switch (key){
    case 'scenario':
    case 'definition':
    case 'demoAnswer':
    case 'demoNote':
    case 'aiPrompt': {
      const v = text.replace(/^> /gm, '').trim();
      return v || undefined;
    }
    case 'defNote': {
      const items = text.split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean);
      return items.length ? items.map(s => '·' + s).join('') : undefined;
    }
    case 'aliases': {
      const v = text.trim();
      return v ? v.split('、').map(s => s.trim()).filter(Boolean) : undefined;
    }
    case 'prereqs': {
      const items = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (!items.length) return undefined;
      return items.map(l => {
        const line = l.replace(/^- /, '').trim();
        const m = line.match(/^(.+?)（见 \[\[([\w-]+)\]\]）$/);
        /* 与原数据形状一致：无链接的项补 id: null（引擎按纯文字胶囊渲染） */
        return m ? { name: m[1], id: m[2] } : { name: line, id: null };
      });
    }
    case 'demo':
      return firstBlock || bad('缺少 ```html 代码块');
    case 'flow': {
      let cur = null, note = null, title = null;
      const steps = [];
      for (const l of ex.text){
        const m1 = l.match(/^当前:\s*(\d+)\s*$/);
        if (m1){ cur = parseInt(m1[1], 10); continue; }
        const mn = l.match(/^说明:\s*(.+)$/);
        const mt = l.match(/^标题:\s*(.+)$/);
        if (mt){ title = mt[1]; continue; }
        if (mn){ note = mn[1]; continue; }
        const m2 = l.match(/^(\d+)\. (.+?)(?: —— (.*))?$/);
        if (m2) steps.push({ tag: m2[2], sub: m2[3] || undefined });
      }
      if (!steps.length || cur === null) bad('缺少「当前: N」或步骤列表');
      return { title: title || undefined, steps: steps, current: cur, note: note || undefined };
    }
    case 'anatomy': {
      /* 中文分册必须带舞台图；英文分册（allowStageLess）只写部件行，舞台图沿用中文壳 */
      if (!firstBlock && !(opts && opts.allowStageLess)) bad('缺少 ```html 舞台图代码块');
      const parts = [];
      for (const l of ex.text){
        const m = l.match(/^(\d+)\. (.+?)(?:（([^）]*)）)?[：:]([\s\S]*)$/);
        if (m) parts.push({ idx: parseInt(m[1], 10), pn: m[2], pe: m[3] || undefined, pd: m[4] || undefined });
      }
      if (!parts.length && !firstBlock) bad('既无舞台图也无部件列表');
      const out = {};
      if (firstBlock) out.stage = firstBlock;
      if (parts.length) out.parts = parts;
      return out;
    }
    case 'demoCtl':
      if (!firstBlock) bad('缺少 ```json 代码块');
      return JSON.parse(firstBlock);
    case 'sections': {
      const secs = [];
      for (const l of ex.text){
        const m = l.match(/^#### (.+)$/);
        if (m) secs.push({ h: m[1], paras: [] });
        else if (secs.length && l.trim()) secs[secs.length - 1].paras.push(l.trim());
      }
      return secs.length ? secs : undefined;
    }
    case 'usage': {
      const out = {};
      let cur = null, curItem = null;
      for (const item of ex.seq){
        if (item.kind === 'block'){ if (curItem) curItem.mock = item.code; continue; }
        const l = item.s;
        if (/^\*\*什么时候用\*\*/.test(l)){ cur = 'do'; if (!out[cur]) out[cur] = []; curItem = null; }
        else if (/^\*\*什么时候不用\*\*/.test(l)){ cur = 'dont'; if (!out[cur]) out[cur] = []; curItem = null; }
        else if (/^- /.test(l) && cur){ curItem = { text: l.slice(2) }; out[cur].push(curItem); }
      }
      return (out.do || out.dont) ? out : undefined;
    }
    case 'variants': {
      const out = [];
      let curItem = null;
      for (const item of ex.seq){
        if (item.kind === 'block'){ if (curItem) curItem.mock = item.code; continue; }
        const m = item.s.match(/^- \*\*(.+?)\*\*(?:（([^）]+)）)?(?:：([\s\S]*))?$/);
        if (m){ curItem = { name: m[1], nameEn: m[2] || undefined, desc: m[3] || undefined }; out.push(curItem); }
      }
      return out.length ? out : undefined;
    }
    case 'scenes': {
      const out = [];
      let curItem = null;
      for (const item of ex.seq){
        if (item.kind === 'block'){ if (curItem) curItem.shot = item.code; continue; }
        if (/^- /.test(item.s)){ curItem = { cap: item.s.slice(2) }; out.push(curItem); }
      }
      return out.length ? out : undefined;
    }
    case 'confusions':
      return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^- vs \*\*(.+?)\*\*：([\s\S]*)$/);
        return m ? { name: m[1], say: m[2] } : bad('混淆行格式：' + l);
      });
    case 'quiz': {
      const nonEmpty = ex.text.map(l => l.trim()).filter(Boolean);
      const optIdx = nonEmpty.findIndex(l => /^- [A-Z]\. /.test(l));
      if (optIdx < 0) bad('缺少选项列表');
      const q = nonEmpty.slice(0, optIdx).join(' ');
      const options = [];
      let answer = null, explain = null;
      for (let i = optIdx; i < nonEmpty.length; i++){
        const l = nonEmpty[i];
        const mo = l.match(/^- ([A-Z])\. ([\s\S]*)$/);
        if (mo) options.push(mo[2]);
        else {
          const ma = l.match(/^答案:\s*([A-Z])\s*$/);
          const me = l.match(/^解析:\s*([\s\S]*)$/);
          if (ma) answer = ma[1].charCodeAt(0) - 65;
          else if (me) explain = me[1];
        }
      }
      if (!q || !options.length || answer === null) bad('题干/选项/答案不完整');
      return { q: q, options: options, answer: answer, explain: explain || undefined };
    }
    case 'next': {
      const out = [];
      for (const l of ex.text){
        const m = l.match(/^- \[\[([\w-]+)\]\](?: —— (.*))?$/);
        if (m) out.push(m[2] ? { id: m[1], note: m[2] } : m[1]);
      }
      return out.length ? out : undefined;
    }
    case 'refs': {
      const out = [];
      for (const l of ex.text){
        const m = l.match(/^- (.+?)：(https?:\/\/\S+)$/);
        if (m) out.push({ name: m[1], url: m[2] });
        else if (/^- /.test(l)) out.push({ name: l.slice(2) });
      }
      return out.length ? out : undefined;
    }
    default:
      bad('未实现的字段');
  }
}

/* ---------- 序列化：词条数组 → 数据区 js 文本 ---------- */

const FIELD_ORDER = ['id', 'topic', 'cat', 'name', 'nameEn', 'scenario', 'definition', 'defNote',
  'prereqs', 'aliases', 'demo', 'demoAnswer', 'demoNote', 'flow', 'anatomy', 'demoCtl',
  'sections', 'usage', 'variants', 'scenes', 'confusions', 'quiz', 'aiPrompt', 'next', 'refs'];

function jsStr(s){
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

export function serializeTerms(terms, varName){
  varName = varName || 'KB_TERMS';
  const entries = terms.map(t => {
    const parts = [];
    for (const k of FIELD_ORDER){
      if (t[k] === undefined || t[k] === null && k !== 'id') continue;
      if (t[k] === null){ parts.push('    ' + k + ': null'); continue; }
      const v = typeof t[k] === 'string' ? jsStr(t[k]) : JSON.stringify(t[k]);
      parts.push('    ' + k + ': ' + v);
    }
    return '  {\n' + parts.join(',\n') + '\n  }';
  });
  return 'var ' + varName + ' = [\n' + entries.join(',\n') + '\n];';
}

/* ---------- 序列化：词条对象 → 规范 md 卡片（与 parseEntry 严格互逆） ---------- */

/* 卡片内各节的书写顺序 = FIELD_ORDER 去掉元信息字段（id/topic/cat/name/nameEn）后的余下部分 */
const MD_FIELD_ORDER = ['scenario', 'definition', 'defNote', 'prereqs', 'aliases', 'demo',
  'demoAnswer', 'demoNote', 'flow', 'anatomy', 'demoCtl', 'sections', 'usage', 'variants',
  'scenes', 'confusions', 'quiz', 'aiPrompt', 'next', 'refs'];

/* 字段 → 节标题（FIELD_TITLES 的反查），保证「写出去」与「读进来」用同一张表 */
const KEY_TITLES = {};
for (const title in FIELD_TITLES) KEY_TITLES[FIELD_TITLES[title]] = title;

/* 代码块三行式：```lang / 内容 / ``` */
function mdCode(lang, code){
  return ['```' + lang].concat(String(code).split('\n'), ['```']);
}

/* 单节内容 → 行数组（顺序即书写顺序，空行由 entryToMd 统一插入） */
function mdField(key, v){
  const out = [];
  switch (key){
    case 'scenario':                       /* 引用块：> 开头 */
      return v.split('\n').map(s => '> ' + s);
    case 'definition':                     /* 以下为普通段落 */
    case 'demoAnswer':
    case 'demoNote':
    case 'aiPrompt':
      return v.split('\n');
    case 'defNote':                        /* 数据里以「·」串成一串，写回时拆成多行列表 */
      return v.replace(/^·/, '').split('·').map(s => '- ' + s);
    case 'prereqs':
      return v.map(p => '- ' + p.name + (p.id ? '（见 [[' + p.id + ']]）' : ''));
    case 'aliases':
      return [v.join('、')];
    case 'demo':
      return mdCode('html', v);
    case 'demoCtl':
      return mdCode('json', JSON.stringify(v, null, 2));
    case 'flow': {
      out.push('当前: ' + v.current);
      if (v.title) out.push('', '标题: ' + v.title);
      if (v.note) out.push('', '说明: ' + v.note);
      out.push('');
      v.steps.forEach((s, i) => out.push((i + 1) + '. ' + s.tag + (s.sub ? ' —— ' + s.sub : '')));
      return out;
    }
    case 'anatomy': {
      if (v.stage) out.push(...mdCode('html', v.stage));
      if (v.stage && v.parts) out.push('');
      if (v.parts) v.parts.forEach(p => out.push(
        p.idx + '. ' + p.pn + (p.pe ? '（' + p.pe + '）' : '') + '：' + (p.pd || '')));
      return out;
    }
    case 'sections':
      v.forEach((s, i) => {
        if (i) out.push('');
        out.push('#### ' + s.h, '');
        s.paras.forEach((p, j) => { if (j) out.push(''); out.push(p); });
      });
      return out;
    case 'usage': {
      const block = (label, items) => {
        if (!items || !items.length) return;
        if (out.length) out.push('');
        out.push('**' + label + '**', '');
        const chunks = items.map(it => it.mock
          ? ['- ' + it.text, '', ...mdCode('html', it.mock)]
          : ['- ' + it.text]);
        chunks.forEach((c, i) => { if (i) out.push(''); out.push(...c); });
      };
      block('什么时候用', v.do);
      block('什么时候不用', v.dont);
      return out;
    }
    case 'variants': {
      /* 与 usage 同构：条目之间空一行，末条后不留空行（避免与下一个节标题之间多出空行） */
      const line = it => '- **' + it.name + '**' + (it.nameEn ? '（' + it.nameEn + '）' : '')
        + (it.desc ? '：' + it.desc : '');
      const chunks = v.map(it => it.mock ? [line(it), '', ...mdCode('html', it.mock)] : [line(it)]);
      chunks.forEach((c, i) => { if (i) out.push(''); out.push(...c); });
      return out;
    }
    case 'scenes':
      v.forEach(it => {
        out.push('- ' + it.cap);
        if (it.shot) out.push('', ...mdCode('html', it.shot));
      });
      return out;
    case 'confusions':
      return v.map(c => '- vs **' + c.name + '**：' + c.say);
    case 'quiz': {
      out.push(v.q, '');
      v.options.forEach((o, i) => out.push('- ' + String.fromCharCode(65 + i) + '. ' + o));
      out.push('', '答案: ' + String.fromCharCode(65 + v.answer));
      if (v.explain) out.push('', '解析: ' + v.explain);
      return out;
    }
    case 'next':
      return v.map(n => typeof n === 'string'
        ? '- [[' + n + ']]'
        : '- [[' + n.id + ']]' + (n.note ? ' —— ' + n.note : ''));
    case 'refs':
      return v.map(r => '- ' + r.name + (r.url ? '：' + r.url : ''));
    default:
      throw new Error('entryToMd：未实现的字段 ' + key);
  }
}

/* 词条对象 → 一张卡片的 md 文本（不含分册文件头）
   seq 为「## N.」里的 N（主线编号）；它是唯一不由词条字段决定的信息，故由调用方传入。
   这张卡片就是「术语卡片模板」的唯一来源：拆卡、Skill A 生成草稿都复用它，避免模板写两处日后漂移。 */
export function entryToMd(term, seq){
  if (!term || !term.id || !term.name) throw new Error('entryToMd：词条缺 id 或 name');
  const L = ['## ' + seq + '. ' + term.name, '',
    '- id: `' + term.id + '`'];
  if (term.topic) L.push('- 主题: `' + term.topic + '`');
  if (term.cat) L.push('- 分类: `' + term.cat + '`');
  if (term.nameEn) L.push('- 英文名: ' + term.nameEn);
  for (const key of MD_FIELD_ORDER){
    if (term[key] === undefined) continue;
    L.push('', '### ' + KEY_TITLES[key], '', ...mdField(key, term[key]));
  }
  return L.join('\n').replace(/\n*$/, '\n');
}

/* ---------- 数据等价比较（递归键排序后逐字符比对） ---------- */

export function normDeep(v){
  if (Array.isArray(v)) return v.map(normDeep);
  if (v && typeof v === 'object'){
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = normDeep(v[k]);
    return o;
  }
  return v;
}
export function deepEqual(a, b){
  return JSON.stringify(normDeep(a)) === JSON.stringify(normDeep(b));
}

/* ---------- 更新日志 Markdown 解析（content/更新日志.md → CHANGELOG 数组）----------
   2026-09-27 起 更新日志权威源从 content/更新日志.js 切换为 Markdown（使用者拍板：网站要上线，
   流程对齐行业常规 Keep a Changelog 的「人写 Markdown → 构建时注入站点」形态）。
   格式约定（拼合.mjs 与 校验.mjs 共用本函数）：
     ## YYYY-MM-DD        条目日期；文件内按日期倒序书写（校验会查）
     ### 标题             条目标题；以「vX.Y.Z 」开头则前缀解析为 version（里程碑徽章）
     - 明细               条目明细若干；支持 [[词条id|文字]] 互链（引擎 fmt 渲染）
     收录: id1, id2       可选行；本期收录新词条 id 列表（校验查 id 存在，渲染成直达卡）
   HTML 注释与无法识别的行一律忽略（说明性文字不进数据）；空壳条目（无标题且无明细）剔除。 */
export function parseChangelogMd(text){
  const out = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)){
    const l = raw.trim();
    if (!l) continue;
    let m = l.match(/^## (\d{4}-\d{2}-\d{2})\s*$/);
    if (m){ cur = { date: m[1], title: '', items: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (l.startsWith('### ')){
      const t = l.slice(4).trim();
      const v = t.match(/^(v\d+\.\d+\.\d+)\s+(.*)$/);
      if (v){ cur.version = v[1]; cur.title = v[2]; } else cur.title = t;
      continue;
    }
    m = l.match(/^收录[:：]\s*(.+)$/);
    if (m){
      cur.terms = m[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      if (!cur.terms.length) delete cur.terms;
      continue;
    }
    if (l.startsWith('- ')) cur.items.push(l.slice(2).trim());
  }
  return out.filter(c => c.title || c.items.length);
}
