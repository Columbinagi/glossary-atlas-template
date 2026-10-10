/* ============================================================
   engineering/校验.mjs —— 交付前自检：知识库 md 可解析 + 产物内联 JS + #debug 报告
   用法：node engineering/校验.mjs [--strict]
     · 默认：行为不变 —— 起不了 Chrome 的项记「⏸ 需外部验证」并计入 manual，**不计入 fail**，
       退出码 0（CI 跑在 ubuntu 上无 Chrome，必须继续绿）。
     · --strict（或 JC_STRICT=1）：任何 manual > 0 即退出码 **2**（区别于 fail 的 1），
       并打印一行「严格模式：N 项未在本机验证」——「退出码 0 ≠ 真检过」这个判定盲区由此补上。
   红线：#debug 0 错误才算完成
   ============================================================ */
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { parseKnowledgeDir, serializeTerms, entryToMd, deepEqual, parseChangelogMd } from './lib-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'dist', '新能源汽车知识图鉴.html');
/* v1.1.5（续 20 修复·F8）：Chrome 路径可被 JC_CHROME 覆盖 —— 让「无 Chrome 时的降级口径」
   本身可被自动化验证（把 JC_CHROME 指到一个不存在的路径即可造出降级场景），也让别的机器能改路径 */
const CHROME = process.env.JC_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/* v1.1.5（续 20 修复·F8）：严格模式开关（命令行 --strict 或环境变量 JC_STRICT=1） */
const STRICT = process.argv.indexOf('--strict') >= 0 || process.env.JC_STRICT === '1';
/* v1.1.5（续 20）：按 id 跳过指定的**需要 Chrome 的**项（`JC_SKIP=③-c,③-k`）——
   只用于「分小批跑」与调试：本文件一次要起十几个无头 Chrome，低配机 / 系统不稳时整轮太久。
   被跳过的项按 manual++ 计（不是静默通过），所以 `--strict` 照样会拦。
   默认（不设 JC_SKIP）行为完全不变 —— CI 与日常一律整轮跑。 */
const SKIP_IDS = (process.env.JC_SKIP || '').split(',').map(s => s.trim()).filter(Boolean);
function skipped(id){ return SKIP_IDS.indexOf(id) >= 0; }
let fail = 0;

/* ① 知识库 md 解析 + 序列化文本语法（等价于站点将生成的数据区） */
let terms = null;
let termsEn = [];
try {
  terms = parseKnowledgeDir(path.join(CONTENT_DIR, '知识库'), { keepMeta: true });
  console.log('✓ 知识库 md 解析：' + terms.length + ' 条');
  for (const t of terms){
    if (!t.id || !t.name || !t.definition){ console.log('✗ 词条缺必填字段：' + (t.id || t.name)); fail++; }
  }
} catch (e){ console.log('✗ 知识库解析失败：' + e.message); fail++; }

/* ①-a 主线编号：唯一（撞车会静默乱序，肉眼看不出来）+ 文件名前缀与卡内编号一致 */
if (terms && terms.length){
  const first = new Map(), dup = [], mismatch = [];
  for (const t of terms){
    if (first.has(t.__seq)) dup.push(t.__seq + '（' + first.get(t.__seq) + ' / ' + t.id + '）');
    else first.set(t.__seq, t.id);
    const m = path.basename(t.__file).match(/^(\d+)-/);
    if (m && parseInt(m[1], 10) !== t.__seq) mismatch.push(t.__file + '：文件名 ' + m[1] + ' ≠ 卡内 ' + t.__seq);
  }
  if (dup.length){ console.log('✗ 主线编号重复：' + dup.join('、')); fail++; }
  else console.log('✓ 主线编号：' + terms.length + ' 个唯一编号（' + terms[0].__seq + ' … ' + terms[terms.length - 1].__seq + '）');
  if (mismatch.length) console.log('⚠ 文件名前缀与卡内编号不一致（跑 node engineering/重排编号.mjs 可一键对齐）：\n   ' + mismatch.join('\n   '));
}

/* ①-b 往返无损：entryToMd 写出的卡片必须能被解析器原样读回
   这条不变量是「一卡一文件」与两个技能（生成卡片 / 收录上线）的地基——写出去的模板读不回来，后面全错 */
if (terms && terms.length){
  const plain = t => { const o = Object.assign({}, t); delete o.__seq; delete o.__file; return o; };
  const tmpDir = path.join(os.tmpdir(), 'kb-roundtrip');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  terms.forEach(t => fs.writeFileSync(path.join(tmpDir, t.id + '.md'), entryToMd(t, t.__seq), 'utf8'));
  const back = parseKnowledgeDir(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const drift = terms.filter((t, i) => !back[i] || !deepEqual(plain(t), back[i])).map(t => t.id);
  if (drift.length){ console.log('✗ 往返无损：' + drift.join(', ') + ' 重解析后字段不等价'); fail++; }
  else console.log('✓ 往返无损：' + terms.length + ' 条卡片「写出 → 读回」逐字段一致');
}

/* ①-c 英文分册（可缺）：解析并对照 id——只报告不判负，悬空 id 由引擎 #debug 拦截 */
try {
  termsEn = parseKnowledgeDir(path.join(CONTENT_DIR, '知识库-en'), { optional: true, allowStageLess: true });
  if (termsEn.length){
    const zhIds = new Set((terms || []).map(t => t.id));
    const miss = termsEn.filter(t => !zhIds.has(t.id)).map(t => t.id);
    console.log('✓ 英文分册：' + termsEn.length + ' 条' + (miss.length ? '（⚠ id 不在中文表：' + miss.join(', ') + '）' : ''));
  } else {
    console.log('· 英文分册：无（KB_TERMS_EN = null，英文模式回退中文）');
  }
} catch (e){ console.log('✗ 英文分册解析失败：' + e.message); fail++; }

/* ①-d 更新日志（2026-09-27 起权威源 = content/更新日志.md，与拼合同用 parseChangelogMd 解析）——
   字段与日期格式检查 + terms 引用的词条 id 必须存在于中文表（防悬空）。
   引擎 #debug 另查一遍（两道闸同源契约） */
let changelog = null, clLoaded = false;
try {
  const clFile = path.join(CONTENT_DIR, '更新日志.md');
  if (fs.existsSync(clFile)){
    changelog = parseChangelogMd(fs.readFileSync(clFile, 'utf8'));
    clLoaded = true;
  }
} catch (e){ console.log('✗ 更新日志解析失败：' + e.message); fail++; }

if (terms && clLoaded && Array.isArray(changelog)){
  const zhIds = new Set(terms.map(t => t.id));
  const bad = [];
  let clErr = 0;
  changelog.forEach((c, i) => {
    const tag = '第 ' + (i + 1) + ' 条';
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(String((c || {}).date || ''))){ bad.push(tag + ' date'); clErr++; }
    if (!c || !c.title){ bad.push(tag + ' title'); clErr++; }
    if (c && c.kind && c.kind !== 'update' && c.kind !== 'terms'){ bad.push(tag + ' kind'); clErr++; }
    if (c && Array.isArray(c.terms)){
      for (const id of c.terms) if (!zhIds.has(id)){ bad.push(tag + ' ' + id); clErr++; }
    }
  });
  const clDates = changelog.map(c => String((c || {}).date || ''));
  const unsorted = clDates.some((d, i) => i > 0 && d && clDates[i - 1] && clDates[i - 1] < d);
  if (clErr){ console.log('✗ 更新日志：' + bad.join('、') + '（date/title 缺失、格式错或引用不存在词条）'); fail++; }
  else if (unsorted){ console.log('✗ 更新日志：未按日期倒序排列'); fail++; }
  else console.log('✓ 更新日志：' + changelog.length + ' 条，词条引用全部有效');
}

/* ①-e 更新日志英文（2026-09-29 起 = content/更新日志-en.md，可选文件）——
   与中文按「日期 + 同日序号」逐条对齐；对不上中文 / 引用悬空 / 中文残留 = fail；
   缺条（中文有、英文无）= fail（中英同补是纪律；引擎侧仅回退中文、不报错） */
let changelogEn = null, clEnLoaded = false;
try {
  const clEnFile = path.join(CONTENT_DIR, '更新日志-en.md');
  if (fs.existsSync(clEnFile)){
    changelogEn = parseChangelogMd(fs.readFileSync(clEnFile, 'utf8'));
    clEnLoaded = true;
  }
} catch (e){ console.log('✗ 更新日志英文解析失败：' + e.message); fail++; }

if (terms && clEnLoaded && Array.isArray(changelogEn)){
  const enZhCount = {};
  (Array.isArray(changelog) ? changelog : []).forEach(c => { const d = String((c || {}).date || ''); enZhCount[d] = (enZhCount[d] || 0) + 1; });
  const enIds = new Set(terms.map(t => t.id));
  const enCount = {}, badEn = [];
  let enErr = 0;
  const CJK = /[\u4e00-\u9fff]/;
  changelogEn.forEach((c, i) => {
    const tag = 'EN 第 ' + (i + 1) + ' 条';
    const d = String((c || {}).date || '');
    enCount[d] = (enCount[d] || 0) + 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)){ badEn.push(tag + ' date'); enErr++; }
    else if (!enZhCount[d] || enCount[d] > enZhCount[d]){ badEn.push(tag + ' 日期对不上中文：' + d + '（同日第 ' + enCount[d] + ' 条）'); enErr++; }
    if (!c || !c.title){ badEn.push(tag + ' title'); enErr++; }
    if (c && Array.isArray(c.terms)){ for (const id of c.terms) if (!enIds.has(id)){ badEn.push(tag + ' ' + id); enErr++; } }
    if (CJK.test(String((c || {}).title || '') + ' ' + ((c || {}).items || []).join(' '))){ badEn.push(tag + ' 含中文字符'); enErr++; }
  });
  let enMissing = 0;
  for (const d of Object.keys(enZhCount)) if ((enCount[d] || 0) < enZhCount[d]) enMissing++;
  if (enErr){ console.log('✗ 更新日志英文：' + badEn.slice(0, 6).join('、') + (badEn.length > 6 ? ' 等' : '') + '（对齐/引用/中文残留）'); fail++; }
  else if (enMissing){ console.log('✗ 更新日志英文：有 ' + enMissing + ' 组日期未对齐中文（缺条；中英需同补）'); fail++; }
  else console.log('✓ 更新日志英文：' + changelogEn.length + ' 条，与中文逐条对齐、无中文残留');
}

/* ①-f 词条清单闸门（2026-10-02 立，使用者提出「每开一个对话就重新选题、容易失控」）——
   `content/词条清单.md` 是内容线的**唯一选题依据**：清单里有的才写，清单外的先加行再写。
   本闸门把这条纪律变成结构，而不是靠自觉：
     · 知识库里的卡片必须在清单里找得到（否则说明有人绕开清单自己加卡）
     · 清单标「已上线」的必须有对应卡片（否则是清单漂移：删了卡没改清单）
     · 编号与中文名必须两边一致（不一致就一定有一边是错的，报错信息直接点名改哪边）
     清单里状态为「待写」的行不参与前两条检查（还没写，本来就没有卡片）。 */
if (terms){
  const clFile = path.join(CONTENT_DIR, '词条清单.md');
  let clRows = null;
  try {
    const raw = fs.readFileSync(clFile, 'utf8');
    clRows = raw.split('\n')
      .filter(l => /^\|\s*\d{3,}\s*\|/.test(l))
      .map(l => { const c = l.split('|').map(s => s.trim()); return { num: c[1], id: c[2], name: c[3], topic: c[4], scope: c[5], state: c[6] }; })
      .filter(r => r.id && r.id !== 'id');
  } catch (e){ /* 文件缺失由下面的分支报 */ }

  if (!clRows){
    console.log('✗ 词条清单：content/词条清单.md 不存在或无法解析（内容线的唯一选题依据不能缺）'); fail++;
  } else {
    const clById = new Map(clRows.map(r => [r.id, r]));
    const bad = [];
    const dupId = clRows.map(r => r.id).filter((v, i, a) => a.indexOf(v) !== i);
    if (dupId.length) bad.push('清单里 id 重复：' + [...new Set(dupId)].join('、'));
    for (const t of terms){
      const r = clById.get(t.id);
      if (!r){ bad.push('卡片不在清单里：' + t.id + '（要新增词条先往 content/词条清单.md 加行）'); continue; }
      if (String(r.num) !== String(t.__seq).padStart(3, '0')) bad.push('编号不一致 ' + t.id + '：清单 ' + r.num + ' / 卡片 ' + t.__seq);
      if (r.name !== t.name) bad.push('中文名不一致 ' + t.id + '：清单「' + r.name + '」/ 卡片「' + t.name + '」');
    }
    const termIds = new Set(terms.map(t => t.id));
    for (const r of clRows){
      if (r.state === '已上线' && !termIds.has(r.id)) bad.push('清单标已上线但没有卡片：' + r.num + ' ' + r.id + '（清单漂移，或卡片被删）');
    }
    const pending = clRows.filter(r => r.state !== '已上线').length;
    if (bad.length){
      console.log('✗ 词条清单：' + bad.slice(0, 5).join('；') + (bad.length > 5 ? ' 等 ' + bad.length + ' 处' : '')); fail++;
    } else {
      console.log('✓ 词条清单：' + clRows.length + ' 行（已上线 ' + (clRows.length - pending) + ' / 待写 ' + pending + '），与知识库编号、名称、状态一致');
    }
  }
}

/* 语法检查 = 进程内 vm.Script 编译，语义与 node --check 等价（同样只编译不执行）。
   2026-09-25 起 spawnSync 子进程在部分本机环境被拦（EBUSY，且非瞬时锁、重试无效），故不再依赖子进程 */
function checkSyntax(code, filename, okMsg){
  try { new vm.Script(code, { filename }); console.log(okMsg); }
  catch (e){ console.log('✗ 语法：' + filename + '\n' + (e.stack || e.message)); fail++; }
}

const tmpArr = path.join(ROOT, 'engineering', '.kb-check.tmp.js');
if (terms){
  let ser = serializeTerms(terms);
  if (termsEn.length) ser += '\n' + serializeTerms(termsEn, 'KB_TERMS_EN');
  checkSyntax(ser, 'KB_TERMS(序列化数据区)', '✓ 语法：序列化数据区文本' + (termsEn.length ? '（含 KB_TERMS_EN）' : ''));
}
fs.rmSync(tmpArr, { force: true });

/* ② 产物存在 + 内联 JS 语法（取最后一个 <script> 块，规避顶部防闪脚本） */
if (!fs.existsSync(OUT)){ console.log('✗ 产物不存在：' + OUT + '（先跑 engineering/拼合.mjs）'); process.exit(1); }
const html = fs.readFileSync(OUT, 'utf8');
const si = html.lastIndexOf('<script>');
const ei = html.indexOf('</' + 'script>', si);
const engine = html.slice(si + 8, ei);
checkSyntax(engine, '站点文件内联 JS', '✓ 语法：站点文件内联 JS（' + engine.length + ' 字符）');

/* ②-b 资产完整性闸门（2026-09-27，因 MEMORY §31-3/§31-4 两坑立）：
   内嵌占位符若未被替换（如 __MANROPE_B64__），vm 语法编译不报错、#debug 也不查，会带着占位符「全绿」上线；
   IDE 旧缓冲回写还可能让磁盘悄悄回退。故对产物做两项硬检查：
   ① 占位符残留必须为 0（通用大写双下划线模式）；② 内嵌字体 payload 必须是真实 base64（非空、够长、字符集合法） */
{
  const placeholders = html.match(/__[A-Z][A-Z0-9_]{2,}__/g) || [];
  if (placeholders.length){
    console.log('✗ 资产完整性：产物残留未替换占位符 → ' + [...new Set(placeholders)].join(', ') + '（注入步骤未完成或被旧缓冲回写——重跑注入，并核对磁盘母版后再拼合）');
    fail++;
  } else console.log('✓ 资产完整性：无占位符残留');
  const badFont = [];
  const re = /url\(data:font\/woff2;base64,([A-Za-z0-9+/=]*)\)/g;
  let m2, fonts = 0;
  while ((m2 = re.exec(html))){
    fonts++;
    if (m2[1].length < 5000) badFont.push('第 ' + fonts + ' 个（仅 ' + m2[1].length + ' 字符）');
    else if (!/^[A-Za-z0-9+/=]+$/.test(m2[1])) badFont.push('第 ' + fonts + ' 个（含非法 base64 字符）');
  }
  if (!fonts){ console.log('✗ 资产完整性：未找到任何内嵌字体（@font-face payload 丢失或被回写）'); fail++; }
  else if (badFont.length){ console.log('✗ 资产完整性：内嵌字体 payload 异常 → ' + badFont.join('、')); fail++; }
  else console.log('✓ 资产完整性：' + fonts + ' 个内嵌字体 payload 均为真实 base64');
}

/* ②-c 拼音映射闸门（2026-09-28 工程线体检 M1 修复）：词条搜索字段（名称/英文名/别名）里出现的
   每个汉字都必须能在 PYI 映射表里查到，否则拼音首字母搜索会对该词条静默失效（不报错、肉眼也看不出）。
   修复路径：用 pypinyin 重新生成映射并补进母版 PYI（一次性工具，做法见 .workbuddy/memory/2026-09-27.md） */
{
  const mp = html.match(/var PYI = (\{[\s\S]*?\});/);
  if (!mp){ console.log('✗ 拼音映射：产物里找不到 PYI 表（母版结构变动？）'); fail++; }
  else {
    let pyi = null;
    try { pyi = JSON.parse(mp[1]); } catch (e){ console.log('✗ 拼音映射：PYI 解析失败 ' + e.message); fail++; }
    if (pyi){
      const miss = [];
      const scan = (t) => {
        const fields = { '名称': t.name, '英文名': t.nameEn, '别名': (t.aliases || []).join('、') };
        for (const k in fields){
          const v = String(fields[k] == null ? '' : fields[k]);
          for (const ch of v){
            if (/[\u4e00-\u9fff]/.test(ch) && !pyi[ch]) miss.push(t.id + '·' + k + '「' + ch + '」');
          }
        }
      };
      (terms || []).forEach(scan);
      (termsEn || []).forEach(scan);
      const uniq = [...new Set(miss)];
      if (uniq.length){
        console.log('✗ 拼音映射：搜索字段缺 ' + uniq.length + ' 个字的映射 → ' + uniq.slice(0, 20).join('、') + (uniq.length > 20 ? ' …' : '') + '（补进母版 PYI 后重拼合）');
        fail++;
      } else console.log('✓ 拼音映射：搜索字段的汉字全部有映射（中文 ' + (terms || []).length + ' 条 + 英文 ' + (termsEn || []).length + ' 条）');
    }
  }
}

/* ③ 无头 Chrome 跑 #debug，抓自检报告（中 / 英两种界面语言各跑一次）
   降级口径：仅当 Chrome 根本无法在本进程内启动（r.error 存在且无输出）时记为「需外部验证」并单独计数，
   不计入 fail、不判通过——验证责任显式移交，由外部命令的实际输出为准 */
let manual = 0;
function headlessDebug(hash, label){
  const url = pathToFileURL(OUT).href + hash;
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  if (r.error && dom.length === 0){
    console.log('⏸ ' + label + '：本进程无法启动 Chrome（' + r.error.code + '），此项需外部验证——');
    console.log('   chrome --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "' + url + '"，报告须含「数据自检通过」「0 错误 · 0 警告」');
    manual++; return;
  }
  const m = dom.match(/id="debugReport">([\s\S]*?)<\/div>/);
  if (!m){ console.log('✗ ' + label + '：未抓到自检报告（Chrome 输出 ' + dom.length + ' 字符）'); fail++; return; }
  const ok = m[1].includes('数据自检通过');
  const zero = /0 错误 · 0 警告/.test(m[1]);
  if (ok && zero) console.log('✓ ' + label + '：0 错误 · 0 警告');
  else { console.log('✗ ' + label + ' 报告：' + m[1].replace(/<[^>]+>/g, ' ').slice(0, 300)); fail++; }
}
if (!skipped('③')){ headlessDebug('#debug', '#debug'); headlessDebug('#debug&lang=en', '#debug&lang=en'); }
else { console.log('⏸ #debug / #debug&lang=en：JC_SKIP 指定跳过（分小批跑）'); manual += 2; }

/* ③-b 搜索语料回归（2026-09-28 工程线体检 D1 修复配套）：界面语言只影响渲染、不影响可检索性——
   英文界面的语料是「英文 + 中文原文」的超集，同一中文关键词与拼音的命中数不得少于中文界面（且中文侧 >0）。
   渲染区只取 #topicView 到 #termView 之间，避免命中页面源码（同 MEMORY §32-8 教训） */
function headlessCardCount(hash){
  const url = pathToFileURL(OUT).href + hash;
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  if (r.error && dom.length === 0) return null;
  const s = dom.indexOf('id="topicView"');
  const e = dom.indexOf('id="termView"');
  const slice = s >= 0 ? dom.slice(s, e > s ? e : dom.length) : '';
  return (slice.match(/data-card=/g) || []).length;
}
if (terms){
  if (skipped('③-b')){
    console.log('⏸ 搜索语料（永磁 / ycdj）：JC_SKIP 指定跳过（分小批跑）'); manual += 2;
  } else {
  const probes = ['永磁', 'ycdj'];
  for (const probe of probes){
    const zhN = headlessCardCount('#topic=t5&q=' + encodeURIComponent(probe));
    const enN = headlessCardCount('#topic=t5&q=' + encodeURIComponent(probe) + '&lang=en');
    if (zhN === null || enN === null){
      console.log('⏸ 搜索语料（' + probe + '）：本进程无法启动 Chrome，此项需外部验证');
      manual++; continue;
    }
    /* 英文语料是超集 ⇒ 命中数只应 ≥ 中文界面；等号是常态，多命中（英文文案含中文词）不算缺陷 */
    if (zhN > 0 && enN >= zhN) console.log('✓ 搜索语料（' + probe + '）：中文界面 ' + zhN + ' 卡 ≤ 英文界面 ' + enN + ' 卡');
    else { console.log('✗ 搜索语料（' + probe + '）：中文界面 ' + zhN + ' 卡 / 英文界面 ' + enN + ' 卡（英文应 ≥ 中文且中文 > 0）'); fail++; }
  }
  }
}

/* ③-c 行为断言（2026-10-08 续 11 新增）：自测页的「已会 N / N」进度数字必须随判定推进。
   为什么需要它：本文件其余项查解析 / 语法 / 拼音 / 清单，#debug 查数据，体检.mjs 查排版 ——
   **没有一条断言"行为"**。2026-10-08 修掉的那个「进度数字恒为 0」缺陷正是这样同时骗过三道闸门的：
   #debug 报 0 错误 0 警告、校验全部通过、体检中英各 64/64，而页面上圆点已是绿·蓝·灰、数字还是 0 / N。
   做法：把产物复制一份注入探针（点一次卡片翻面 → 判「会了」→ 读 #fCount），用 --dump-dom 取回结果。
   判据：**第一次判定后，已会数必须等于 1**（分母随卡数变化，故只断言分子与"分母 ≥ 1"）。 */
function headlessPracticeProgress(){
  const probe = '<script>(function(){' +
    'function step(){' +
    'var card=document.getElementById("fCard");' +
    'if(!card){document.title="PRACTICE_PROBE:no-card";return;}' +
    'card.click();' +
    'var yes=document.getElementById("fYes");' +
    'if(!yes){document.title="PRACTICE_PROBE:no-yes";return;}' +
    'yes.click();' +
    'var c=document.getElementById("fCount");' +
    'document.title="PRACTICE_PROBE:"+(c?c.textContent.trim():"(no-fCount)");}' +
    'if(document.readyState==="complete")setTimeout(step,400);' +
    'else window.addEventListener("load",function(){setTimeout(step,400);});' +
    '})();<\/script>';
  let html;
  try { html = fs.readFileSync(OUT, 'utf8'); } catch (e){ return '(读不到产物)'; }
  const tmp = path.join(os.tmpdir(), 'jc-practice-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=6000', '--dump-dom',
    pathToFileURL(tmp).href + '#practice'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>PRACTICE_PROBE:([^<]*)<\/title>/);
  return m ? m[1] : '(未抓到探针)';
}
{
  const got = skipped('③-c') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessPracticeProgress();
  if (got === null){
    console.log('⏸ 行为断言（自测进度数字）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (got.indexOf('SKIP:') === 0){
    console.log('⏸ 行为断言（自测进度数字）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else {
    const m = got.match(/已会\s*(\d+)\s*\/\s*(\d+)/);
    if (m && m[1] === '1' && Number(m[2]) >= 1) console.log('✓ 行为断言：判 1 张「会了」后进度数字 = ' + got);
    else { console.log('✗ 行为断言：判 1 张「会了」后进度数字应为「已会 1 / N（N≥1）」，实测「' + got + '」'); fail++; }
  }
}

/* ③-d 行为断言（2026-10-08 续 14 新增）：返回列表的 morph 起点必须可信。
   为什么需要它：动画也是"行为"，和进度数字一样不会出现在解析 / 语法 / #debug / 排版体检任何一道闸门里
   （理由同 ③-c）。2026-10-08 使用者报障：「详情页往下滑之后点返回，卡片从屏幕外很高的地方弹回原位」——
   根因是 morph 的起点就是 #detail-hero **当时那一帧**的视口方框，详情页一滚它就被顶到视口上方：
     下滚 0px → 起点 y=231、终点 y=294，位移 63px（设计值）
     下滚 600px → 起点 y=−369，位移 663px
     下滚 1800px → 起点 y=−1569，位移 1863px，450ms 内播完（实测 1280×800 / Chrome 154）
   修法：hero 顶边已被滚出视口时**不挂 morph 名**，退化为页面级淡入（引擎里既有的退化路径）。
   判据（只看 startViewTransition 被调用那一刻谁挂着 view-transition-name="morph"，
   **不依赖动画时序**——无头 + 虚拟时间下 VT 回调本就不保证触发，见引擎里的 250ms 兜底注释）：
     A 列表 → 详情（点卡片）    ：必须是被点的那张卡片挂着 morph（打开动画不许被误伤）
     B 详情 → 列表（详情未滚）  ：必须是 #detail-hero 挂着 morph
     C 详情 → 列表（详情滚到底）：必须没有任何元素挂 morph，且滚动与落点跟点开前一致
   跑**母版**而不是产物：引擎逐字节随拼合进产物（拼合按 MARK_ENG 切），而母版自带长示例数据、
   能稳定构造「滚到底」；净室起步只写一张短示例卡，构造不出来（那种情况报 ⏸ 而不是假绿）。 */
function headlessMorphGate(){
  const TEMPLATE = path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var rec = { named: '(未调用)' };
  var orig = document.startViewTransition;
  try {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, writable: true, value: function(){
      var hit = 'none';
      var all = document.querySelectorAll('[data-card], #detail-hero');
      for (var i = 0; i < all.length; i++){
        var st = all[i].style;
        if (st && st.viewTransitionName === 'morph'){
          hit = all[i].id ? ('#' + all[i].id) : ('card:' + all[i].getAttribute('data-card'));
          break;
        }
      }
      rec.named = hit;
      return orig.apply(document, arguments);
    }});
  } catch (e){}
  var res = {}, id = null;
  var heroTopC = 'null', listScrollYC = 'null', deepScrollYC = 'null', cardTopC = 'null',
      cardTopAfter = 'null', scrollYAfter = 'null';
  function reset(){ rec = { named: '(未调用)' }; }
  function topOf(sel){ var n = document.querySelector(sel); if (!n) return 'null'; return Math.round(n.getBoundingClientRect().top); }
  function report(){
    document.title = 'MORPH_PROBE:A=' + res.A + '|B=' + res.B + '|C=' + res.C +
      '|heroTopC=' + heroTopC + '|listScrollYC=' + listScrollYC + '|deepScrollYC=' + deepScrollYC +
      '|cardTopC=' + cardTopC + '|cardTopAfter=' + cardTopAfter + '|scrollYAfter=' + scrollYAfter;
  }
  function stepA(){
    var card = document.querySelector('[data-card]');
    if (!card){ document.title = 'MORPH_PROBE:no-card'; return; }
    id = card.getAttribute('data-card');
    reset();
    card.querySelector('.card-link').click();
    setTimeout(function(){ res.A = rec.named; stepB(); }, 500);
  }
  function stepB(){
    var back = document.querySelector('[data-back]');
    if (!back){ res.B = 'no-back'; res.C = 'no-back'; return report(); }
    reset();
    back.click();
    setTimeout(function(){ res.B = rec.named; stepC(); }, 500);
  }
  function stepC(){
    var card = document.querySelector('[data-card="' + id + '"]');
    if (!card){ res.C = 'no-target-card'; return report(); }
    listScrollYC = Math.round(window.scrollY);
    cardTopC = topOf('[data-card="' + id + '"]');
    reset();
    card.querySelector('.card-link').click();
    setTimeout(function(){
      var se = document.scrollingElement || document.documentElement;
      se.scrollTop = se.scrollHeight;                     /* 滚到底 = 使用者报障的那种阅读位置 */
      heroTopC = topOf('#detail-hero');
      deepScrollYC = Math.round(window.scrollY);
      var back = document.querySelector('[data-back]');
      if (!back){ res.C = 'no-back-2'; return report(); }
      reset();
      back.click();
      setTimeout(function(){
        res.C = rec.named;
        var se2 = document.scrollingElement || document.documentElement;
        scrollYAfter = Math.round(se2.scrollTop);
        cardTopAfter = topOf('[data-card="' + id + '"]');
        report();
      }, 600);
    }, 500);
  }
  function start(){ setTimeout(stepA, 400); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-morph-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>MORPH_PROBE:([^<]*)<\/title>/);
  return m ? m[1] : 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
}
{
  const got = skipped('③-d') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessMorphGate();
  if (got === null){
    console.log('⏸ 行为断言（返回列表 morph）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (got.indexOf('SKIP:') === 0){
    console.log('⏸ 行为断言（返回列表 morph）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else {
    const g = {};
    got.replace(/([A-Za-z]+)=([^|]*)/g, (m, k, v) => { g[k] = v; return m; });
    const notCalled = ['A', 'B', 'C'].filter(k => g[k] === '(未调用)');
    const broken = ['no-card', 'no-back', 'no-back-2', 'no-target-card'];
    if (notCalled.length === 3){
      console.log('⏸ 行为断言（返回列表 morph）：本环境未跑起 View Transitions（不支持 / 开了「减少动态效果」），此项需外部验证');
      manual++;
    } else if (broken.indexOf(g.A) >= 0 || broken.indexOf(g.B) >= 0 || broken.indexOf(g.C) >= 0){
      console.log('✗ 行为断言（返回列表 morph）：探针场景没构造起来 → ' + got); fail++;
    } else if (notCalled.length){
      console.log('✗ 行为断言（返回列表 morph）：A/B/C 三段里有的播了过渡、有的没播 → ' + got); fail++;
    } else if (g.A.indexOf('card:') !== 0){
      console.log('✗ 行为断言（返回列表 morph）：列表→详情应让被点的卡片挂 morph，实测 A=' + g.A); fail++;
    } else if (g.B !== '#detail-hero'){
      console.log('✗ 行为断言（返回列表 morph）：详情未滚时返回应让 #detail-hero 挂 morph，实测 B=' + g.B); fail++;
    } else if (g.C !== 'none'){
      console.log('✗ 行为断言（返回列表 morph）：详情滚到底后返回不应再挂 morph（否则卡片会从视口外飞回原位），实测 C=' + g.C + '（hero 在视口 y=' + g.heroTopC + '）'); fail++;
    } else if (!(Number(g.heroTopC) < 0)){
      console.log('⏸ 行为断言（返回列表 morph）：无头视口下母版示例详情页滚不动（hero 仍在 y=' + g.heroTopC + '），深滚场景构造不出来，此项需外部验证');
      manual++;
    } else if (!(Math.abs(Number(g.cardTopC) - Number(g.cardTopAfter)) <= 2) || g.scrollYAfter !== g.listScrollYC){
      console.log('✗ 行为断言（返回列表 morph）：滚动 / 落点没恢复——点开前卡片 y=' + g.cardTopC + ' scrollY=' + g.listScrollYC +
        '，返回后卡片 y=' + g.cardTopAfter + ' scrollY=' + g.scrollYAfter); fail++;
    } else {
      console.log('✓ 行为断言（返回列表 morph）：打开卡片 A=' + g.A + '；未滚返回 B=' + g.B + '；滚到底返回 C=' + g.C +
        '（hero 被顶到 y=' + g.heroTopC + '，落点 ' + g.cardTopC + '→' + g.cardTopAfter + '，scrollY ' + g.listScrollYC + '→' + g.scrollYAfter + '）');
    }
  }
}

/* ③-e / ③-f 行为断言（2026-10-08 续 15 新增）：导航时把「临时状态」清干净。
   来历：同类缺陷普查（`notes/20261008_同类缺陷普查.md`）沿「跨时刻取几何 / 跨视图取状态」查出的两条 ——
     E 页面级状态残留：parseHash 对 `#term=…` 是**提前 return** 的，而 `state.changelog / practice / compare`
       的重置写在 return **之后** → 从更新日志点进词条时 changelog 残留为 true：① body 被挂 is-changelog
       （侧栏消失、主区居中：同一个详情页两套 chrome）② hashOf 里 changelog 的优先级高于 term，
       在该详情页切语言（updateHash）会落到 `#changelog&lang=en`，**正在读的词条被带走**。
     F 放大态残留：放大示意图是「全屏模态 + body{overflow:hidden}」，而 closeZoom() 只挂在 Esc / × / 点遮罩
       上 → 放大态按浏览器后退，模态不关、滚动锁不解、**用户滚轮滚不动**。
   判据（只看导航之后的 DOM / URL，不看动画时序）：
     E：`#changelog` → 点词条进详情 → body 不得含 `is-changelog` 且详情可见；再切语言 → hash 仍须 `#term=…`、详情仍在
     F：进详情 → 放大示意图 → `history.back()` → 遮罩必须已隐藏、`body.style.overflow` 必须已还原 */
function headlessNavStateGate(){
  const TEMPLATE = path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var out = {};
  function snap(){ return {
    hash: location.hash,
    isChangelog: document.body.className.indexOf('is-changelog') >= 0,
    detailVisible: !document.getElementById('termView').hidden,
    listVisible: !document.getElementById('topicView').hidden,
    maskHidden: document.getElementById('zoomMask').hidden,
    overflow: document.body.style.overflow }; }
  function report(){ document.title = 'NAVSTATE_PROBE:' + JSON.stringify(out); }
  function step1(){                                       /* 更新日志 → 点词条 */
    location.hash = '#changelog';
    setTimeout(function(){
      var link = document.querySelector('#topicView .cl-term[href^="#term="]');
      if (!link){ out.E = 'no-cl-term'; return step3(); }
      link.click();
      setTimeout(function(){ var s = snap(); out.E_chrome = s.isChangelog; out.E_detail = s.detailVisible; step2(); }, 700);
    }, 700);
  }
  function step2(){                                       /* 在这个详情页切语言 */
    document.getElementById('langBtn').click();
    setTimeout(function(){
      var opt = document.querySelector('#langPop [data-langset="en"]');
      if (!opt){ out.E = 'no-lang-opt'; return step3(); }
      opt.click();
      setTimeout(function(){ var s = snap(); out.E_hash = s.hash; out.E_detail2 = s.detailVisible; step3(); }, 800);
    }, 150);
  }
  function step3(){                                       /* 放大示意图 → 浏览器后退 */
    location.hash = '#topic=t5';
    setTimeout(function(){
      var card = document.querySelector('#topicView [data-card] .card-link');
      if (!card){ out.F = 'no-card'; return report(); }
      card.click();
      setTimeout(function(){
        var z = document.querySelector('[data-zoom]');
        if (!z){ out.F = 'no-zoom'; return report(); }
        z.click();
        setTimeout(function(){
          out.F_open = !snap().maskHidden;
          history.back();
          setTimeout(function(){ var s = snap(); out.F_maskHidden = s.maskHidden; out.F_overflow = s.overflow; out.F_list = s.listVisible; report(); }, 900);
        }, 250);
      }, 800);
    }, 700);
  }
  function start(){ setTimeout(step1, 500); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-navstate-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=12000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>NAVSTATE_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-e/③-f') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessNavStateGate();
  if (got === null){
    console.log('⏸ 行为断言（导航清场）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（导航清场）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else if (got.E === 'no-cl-term' && got.F === 'no-zoom'){
    console.log('⏸ 行为断言（导航清场）：母版示例数据里构造不出场景（更新日志无收录词条链接 / 详情页无示意图），此项需外部验证');
    manual++;
  } else {
    /* E 页面级状态残留 */
    if (got.E){
      console.log('⏸ 行为断言（E 页面级状态残留）：场景构造失败（' + got.E + '），此项需外部验证'); manual++;
    } else if (got.E_chrome === true || got.E_detail !== true){
      console.log('✗ 行为断言（E 页面级状态残留）：从更新日志进详情后 body 不应含 is-changelog、详情必须可见 —— 实测 is-changelog=' +
        got.E_chrome + '、detailVisible=' + got.E_detail); fail++;
    } else if (!/^#term=/.test(String(got.E_hash)) || got.E_detail2 !== true){
      console.log('✗ 行为断言（E 页面级状态残留）：在该详情页切语言后仍应是 #term=… 且详情可见 —— 实测 hash=' +
        got.E_hash + '、detailVisible=' + got.E_detail2 + '（原先会被带到 #changelog）'); fail++;
    } else {
      console.log('✓ 行为断言（E 页面级状态残留）：从 #changelog 进详情的 chrome 正常（is-changelog=false），切语言后仍是 ' + got.E_hash + '、详情可见');
    }
    /* F 放大态跨导航残留 */
    if (got.F){
      console.log('⏸ 行为断言（F 放大态残留）：场景构造失败（' + got.F + '），此项需外部验证'); manual++;
    } else if (got.F_open !== true){
      console.log('✗ 行为断言（F 放大态残留）：探针没能把放大示意图打开（可能选择器变了）'); fail++;
    } else if (got.F_maskHidden !== true || got.F_overflow !== ''){
      console.log('✗ 行为断言（F 放大态残留）：放大态按浏览器后退后，遮罩应已隐藏、body 滚动锁应已还原 —— 实测遮罩隐藏=' +
        got.F_maskHidden + '、overflow=' + JSON.stringify(got.F_overflow) + '（用户会滚不动）'); fail++;
    } else {
      console.log('✓ 行为断言（F 放大态残留）：放大示意图后按浏览器后退 → 遮罩已收（maskHidden=true）、滚动锁已还原（overflow=""）');
    }
  }
}

/* ③-j 行为断言（2026-10-09 续 19 新增·F5）：导航时必须收起浮层。
   来历：同类缺陷普查的 F5 —— 语言浮层 / 主题色浮层 / 各视图的自绘下拉（.dd）只挂在
   「点外部」「Esc」「再点一次按钮」三条路上，任何 hash 导航（浏览器后退 / 点词条 / 点导航项）
   都不会收，浮层就跨视图留在屏上。修法与 closeZoom() 同一口径：paint() 里统一收场。
   判据（只看导航之后的 DOM）：
     A 打开语言浮层 → `history.back()`（真后退）→ `#langPop.hidden` 必须为 true、`#langSw` 不带 open
     B 打开主题色浮层 → 改 hash 导航      → `#colorPop.hidden` 必须为 true
     C 打开 .dd 下拉（自测视图的选主题）→ `history.back()` → `.dd.open` 数量必须为 0
   三个场景都必须**先真的打开了**（否则是假绿）。 */
function headlessOverlayGate(){
  const TEMPLATE = process.env.JC_TEMPLATE ? path.resolve(process.env.JC_TEMPLATE) : path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var out = {};
  function report(){ document.title = 'OVERLAY_PROBE:' + JSON.stringify(out); }
  function snap(){ return { hash: location.hash,
    langHidden: document.getElementById('langPop').hidden,
    langOpenCls: document.getElementById('langSw').className.indexOf('open') >= 0,
    colorHidden: document.getElementById('colorPop').hidden,
    ddOpen: document.querySelectorAll('.dd.open').length }; }
  function start(){
    location.hash = '#topic=t2';
    setTimeout(function(){
      document.getElementById('langBtn').click();
      out.A_open = !document.getElementById('langPop').hidden;
      history.back();
      setTimeout(function(){ var s = snap(); out.A_hash = s.hash; out.A_langHidden = s.langHidden; out.A_langOpenCls = s.langOpenCls; step2(); }, 1000);
    }, 900);
  }
  function step2(){
    location.hash = '#topic=t1';
    setTimeout(function(){
      document.getElementById('colorBtn').click();
      out.B_open = !document.getElementById('colorPop').hidden;
      location.hash = '#topic=t3';
      setTimeout(function(){ out.B_colorHidden = snap().colorHidden; step3(); }, 1000);
    }, 900);
  }
  function step3(){
    location.hash = '#practice';
    setTimeout(function(){
      var dd = document.querySelector('#topicView .dd[data-dd="practiceTopic"]');
      if (!dd){ out.C_err = 'no-dd'; return report(); }
      var b = dd.querySelector('.dd-btn');
      if (b) b.click();
      out.C_open = document.querySelectorAll('.dd.open').length;   /* 必须立刻量：下一次重渲就会收掉 */
      history.back();
      setTimeout(function(){ out.C_afterBack = snap().ddOpen; report(); }, 1000);
    }, 1000);
  }
  if (document.readyState === 'complete') setTimeout(start, 600);
  else window.addEventListener('load', function(){ setTimeout(start, 600); });
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-overlay-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=12000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>OVERLAY_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-j') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessOverlayGate();
  if (got === null){
    console.log('⏸ 行为断言（导航收起浮层）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（导航收起浮层）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else {
    const bad = [];
    if (got.A_open !== true) bad.push('A 探针没能打开语言浮层（选择器变了？）');
    else if (got.A_langHidden !== true || got.A_langOpenCls === true) bad.push('A 语言浮层按浏览器后退后仍开着（hash=' + got.A_hash + '、hidden=' + got.A_langHidden + '、按钮带 open=' + got.A_langOpenCls + '）');
    if (got.B_open !== true) bad.push('B 探针没能打开主题色浮层');
    else if (got.B_colorHidden !== true) bad.push('B 主题色浮层在 hash 导航后仍开着');
    if (got.C_err) bad.push('C 探针场景构造失败（' + got.C_err + '）');
    else if (got.C_open !== 1) bad.push('C 探针没能打开 .dd 下拉（实测 open=' + got.C_open + '）');
    else if (got.C_afterBack !== 0) bad.push('C 自绘下拉在浏览器后退后仍开着（实测 open=' + got.C_afterBack + '）');
    if (bad.length){
      console.log('✗ 行为断言（导航收起浮层）：' + bad.join('；')); fail++;
    } else {
      console.log('✓ 行为断言（导航收起浮层）：语言浮层后退已收（hidden=true、按钮不带 open）；主题色浮层 hash 导航已收；自绘下拉后退已收（open 1 → 0）');
    }
  }
}

/* ③-k 行为断言（2026-10-09 续 19 新增·F6）：切语言保留的是「内容位置」而不只是 scrollY。
   来历：同类缺陷普查的 F6 —— 中英分册逐项 1:1 镜像但字宽不同，重排后同一节高度会变，
   只恢复 scrollY 会让「你正在读的那一节」在视口里挪位（实测 1280×800 挪 24px；窄屏最多 342px）。
   修法：切换前记「当前视图根里第一个 top ≥ 120 的子节点」的索引路径 ＋ 它当时的视口 top，
   重渲后按同一条路径找回来对齐；找不到退回 scrollY 口径。
   判据：把某个分节顶边停在视口 120px → 切英文 → **同一节的 top 偏移 ≤ 4px**（而不是断言 scrollY 不变）。 */
function headlessLangAnchorGate(){
  const TEMPLATE = process.env.JC_TEMPLATE ? path.resolve(process.env.JC_TEMPLATE) : path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var out = {};
  function report(){ document.title = 'LANGANCHOR_PROBE:' + JSON.stringify(out); }
  function secs(){ return document.querySelectorAll('#topicView [data-catsec]'); }
  function start(){
    var chip = document.querySelector('#topicChips .topic-chip[aria-pressed="true"]') || document.querySelector('#topicChips .topic-chip');
    if (!chip){ out.err = 'no-chip'; return report(); }
    var topic = chip.getAttribute('data-topic');
    if (location.hash !== '#topic=' + topic){ location.hash = '#topic=' + topic; setTimeout(run, 1000); }
    else run();
    function run(){
      var s = secs();
      if (s.length < 2){ out.err = 'sections=' + s.length; return report(); }
      var se = document.scrollingElement, max = se.scrollHeight - innerHeight;
      var k = -1, need = -1;
      for (var i = s.length - 1; i >= 0; i--){
        var nd = window.scrollY + s[i].getBoundingClientRect().top - 120;
        if (nd >= 0 && nd <= max + 1){ k = i; need = nd; break; }
      }
      if (k < 0){ out.err = 'no-placeable-section'; return report(); }
      window.scrollTo(0, need);
      out.secIndex = k;
      out.beforeTop = Math.round(s[k].getBoundingClientRect().top * 100) / 100;
      out.beforeScrollY = Math.round(window.scrollY);
      document.getElementById('langBtn').click();
      setTimeout(function(){
        var opt = document.querySelector('#langPop [data-langset="en"]');
        if (!opt){ out.err = 'no-lang-opt'; return report(); }
        opt.click();
        setTimeout(function(){
          var s2 = secs();
          out.lang = document.documentElement.lang || '';
          out.hash = location.hash;
          out.afterScrollY = Math.round(window.scrollY);
          out.afterTop = s2[k] ? Math.round(s2[k].getBoundingClientRect().top * 100) / 100 : null;
          out.delta = (out.afterTop === null) ? null : Math.round((out.afterTop - out.beforeTop) * 100) / 100;
          report();
        }, 1000);
      }, 200);
    }
  }
  if (document.readyState === 'complete') setTimeout(start, 600);
  else window.addEventListener('load', function(){ setTimeout(start, 600); });
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-langanchor-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=12000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>LANGANCHOR_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-k') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessLangAnchorGate();
  if (got === null){
    console.log('⏸ 行为断言（切语言保留内容位置）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（切语言保留内容位置）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else if (got.err){
    console.log('⏸ 行为断言（切语言保留内容位置）：母版示例里构造不出场景（' + got.err + '），此项需外部验证');
    manual++;
  } else if (got.lang !== 'en'){
    console.log('✗ 行为断言（切语言保留内容位置）：探针没能真的切到英文（lang=' + got.lang + '、hash=' + got.hash + '）'); fail++;
  } else if (got.afterTop === null){
    console.log('✗ 行为断言（切语言保留内容位置）：切语言后找不到同一个分节（索引 ' + got.secIndex + '）'); fail++;
  } else if (Math.abs(got.delta) > 4){
    console.log('✗ 行为断言（切语言保留内容位置）：切语言后同一节在视口挪了 ' + got.delta + 'px（应 ≤ 4px）—— 实测 top ' +
      got.beforeTop + ' → ' + got.afterTop + '、scrollY ' + got.beforeScrollY + ' → ' + got.afterScrollY + '（只恢复 scrollY 就会这样）'); fail++;
  } else {
    console.log('✓ 行为断言（切语言保留内容位置）：第 ' + (got.secIndex + 1) + ' 节视口 top ' + got.beforeTop + ' → ' +
      got.afterTop + '（偏移 ' + got.delta + 'px ≤ 4px，scrollY ' + got.beforeScrollY + ' → ' + got.afterScrollY + '）');
  }
}

/* ③-l 行为断言（2026-10-09 续 19 新增·F7）：无障碍两项 —— 「跳到主内容」＋ 焦点环收成一套。
   来历：ACCEPTANCE §三「未列入必修」那条 —— ① 无 skip link ② 焦点环两套风格（实测 6 个顶栏控件
   在用浏览器默认环 `auto 1px rgb(16,16,16)`，与旁边的品牌色环并排就是两种风格）。
   判据：
     A `.skip-link` 存在、`href` 指向真实存在的容器、该容器 `tabindex="-1"`、默认隐藏（transform 有位移）
     B 聚焦后必须可见（transform 变 none）、且它确实是文档里**第一个**可聚焦元素
     C 每个「可见 · 有尺寸 · 可聚焦」的控件，聚焦后的计算环必须同源：`solid 2px` ＋ 品牌色
   ⚠️ 环境事实：`--virtual-time-budget` 下 CSS 过渡**不推进**（实测加了 .15s 过渡后计算值永远停在
      起始位置；`:focus` 命中、置 `transition:none` 立刻变 none 都验过）——所以 skip link 刻意不做过渡，
      这条断言才判得动。程序化 `.focus()` 在该环境下会命中 `:focus-visible`（实测），故可以直接量计算值。 */
function headlessA11yGate(){
  const TEMPLATE = process.env.JC_TEMPLATE ? path.resolve(process.env.JC_TEMPLATE) : path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var out = { ringBad: [] };
  function report(){ document.title = 'A11Y_PROBE:' + JSON.stringify(out); }
  function hex2rgb(h){
    h = h.trim().replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return 'rgb(' + parseInt(h.slice(0,2),16) + ', ' + parseInt(h.slice(2,4),16) + ', ' + parseInt(h.slice(4,6),16) + ')';
  }
  function start(){
    out.brandHex = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    var brand = hex2rgb(out.brandHex);
    out.brandRgb = brand;
    var sl = document.querySelector('.skip-link');
    out.hasSkipLink = !!sl;
    if (sl){
      out.skipHref = sl.getAttribute('href');
      var t = document.querySelector(sl.getAttribute('href'));
      out.skipTargetExists = !!t;
      out.skipTargetTabindex = t ? (t.getAttribute('tabindex') || '') : '';
      out.skipFirstFocusable = document.querySelector('a[href],button,input,select,textarea,[tabindex]') === sl;
      out.skipHiddenBefore = getComputedStyle(sl).transform;
      sl.focus();
      out.skipFocused = document.activeElement === sl;
      var cs0 = getComputedStyle(sl);
      out.skipRing = cs0.outlineStyle + ' ' + cs0.outlineWidth + ' ' + cs0.outlineColor;
      out.skipVisibleAfterFocus = cs0.transform;
      sl.blur();
    }
    var all = document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]');
    var counted = 0;
    for (var i = 0; i < all.length; i++){
      var n = all[i];
      if (n.disabled || n.tabIndex < 0) continue;
      if (n.closest('[hidden]')) continue;
      var r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var disp = getComputedStyle(n);
      if (disp.display === 'none' || disp.visibility === 'hidden') continue;
      counted++;
      try { n.focus(); } catch (e){ continue; }
      var c = getComputedStyle(n);
      if (!(c.outlineStyle === 'solid' && c.outlineColor === brand && c.outlineWidth === '2px')){
        out.ringBad.push((n.id ? '#' + n.id : (n.className && typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\\s+/)[0] : n.tagName.toLowerCase())) +
          ' → ' + c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor);
      }
      n.blur();
    }
    out.ringChecked = counted;
    report();
  }
  if (document.readyState === 'complete') setTimeout(start, 700);
  else window.addEventListener('load', function(){ setTimeout(start, 700); });
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-a11y-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=1280,900', '--virtual-time-budget=12000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>A11Y_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-l') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessA11yGate();
  if (got === null){
    console.log('⏸ 行为断言（无障碍：跳转链接与焦点环）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（无障碍：跳转链接与焦点环）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else {
    const bad = [];
    if (got.hasSkipLink !== true) bad.push('A 没有「跳到主内容」链接（.skip-link）');
    else {
      if (!/^#/.test(String(got.skipHref)) || got.skipTargetExists !== true) bad.push('A skip link 的 href（' + got.skipHref + '）没指向真实存在的容器');
      if (got.skipTargetTabindex !== '-1') bad.push('A 目标容器缺 tabindex="-1"（跳过去焦点落不下来）');
      if (got.skipFirstFocusable !== true) bad.push('A skip link 不是文档里第一个可聚焦元素（Tab 第一下到不了）');
      if (got.skipVisibleAfterFocus !== 'none') bad.push('A skip link 聚焦后仍不可见（transform=' + got.skipVisibleAfterFocus + '）');
    }
    if (got.ringChecked === 0) bad.push('C 一个可聚焦控件都没量到（探针选择器或页面结构变了）');
    else if (got.ringBad && got.ringBad.length) bad.push('C ' + got.ringBad.length + ' 个控件的焦点环不同源 → ' + got.ringBad.join('、'));
    if (bad.length){
      console.log('✗ 行为断言（无障碍：跳转链接与焦点环）：' + bad.join('；')); fail++;
    } else {
      console.log('✓ 行为断言（无障碍：跳转链接与焦点环）：skip link → ' + got.skipHref + '（目标 tabindex=' + got.skipTargetTabindex +
        '、第一个可聚焦、聚焦后可见）；' + got.ringChecked + ' 个可见可聚焦控件焦点环全部同源（solid 2px ' + got.brandRgb + '）');
    }
  }
}

/* ③-m 行为断言（2026-10-09 续 20 新增·F8）：`--strict` 把「退出码 0 ≠ 真检过」这个盲区补上。
   来历：本文件原先在起不了 Chrome 时把相关项记「⏸ 需外部验证」并 manual++，最终
   `process.exit(fail === 0 ? 0 : 1)` —— **退出码 0 不代表真的检过**，README/docs 只写了说明。
   修法：加 `--strict`（或 JC_STRICT=1）；默认行为不变（CI 在 ubuntu 上无 Chrome，必须继续绿），
   严格模式下 manual > 0 即退出码 **2**（区别于 fail 的 1）。
   判据：把 JC_CHROME 指到一个不存在的路径各跑一次本脚本 —— 默认退出 0、`--strict` 退出 2、
   且严格模式打印「严格模式：N 项未在本机验证」。这是**行为断言**：真跑一次子进程看退出码，
   不是 grep 源码。⚠️ 必须在产物已存在时跑（否则脚本在产物缺失处就 process.exit(1) 了）。
   ⚠️ 防自我递归见函数头注释：子进程必须带 `JC_GATE_CHILD` 记号，且 JC_SKIP 里强制含 ③-m。 */
function strictExitGate(){
  /* ⚠️ 防自我递归（20261010 评审补）：本闸门要 spawn 本脚本 —— 子进程若**再进 ③-m**，就会每层生 2 个、
     深度无上限（spawnSync 逐层等待 ⇒ 永不返回、进程与内存线性失控）。
     实测形态：`起步.mjs`（或 CI 的 smoke.yml）以继承环境跑 `校验.mjs`、不设 JC_SKIP 时命中这条路 ——
     20261010 22:34 那次「自己跑验证.ps1」正卡在「步骤 2：起步.mjs」且 `验证报告.txt` 未生成。
     双保险：① 子进程带 `JC_GATE_CHILD=1` 记号，一进来就直接降级为 ⏸；② 子进程的 JC_SKIP 里**强制含 ③-m**。 */
  if (process.env.JC_GATE_CHILD === '1') return 'SKIP:本进程是 ③-m 造出的子进程（防自我递归，不再嵌套）';
  if (!fs.existsSync(OUT)) return 'SKIP:产物不存在（本项要在拼合之后才跑得动）';
  const SELF = fileURLToPath(import.meta.url);
  const fake = path.join(os.tmpdir(), '__no_such_chrome__', 'chrome.exe');
  const env = Object.assign({}, process.env, { JC_CHROME: fake, JC_GATE_CHILD: '1',
    JC_SKIP: SKIP_IDS.concat(['③-m']).join(',') });
  const base = ['--headless=new'];
  const r1 = spawnSync(process.execPath, [SELF].concat(base), { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  const r2 = spawnSync(process.execPath, [SELF, '--strict'], { encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  return {
    defCode: r1.status,
    strictCode: r2.status,
    strictSaid: /严格模式：\d+ 项未在本机验证/.test(r2.stdout || ''),
    defManual: (String(r1.stdout || '').match(/⏸/g) || []).length,
    strictManual: (String(r2.stdout || '').match(/⏸/g) || []).length
  };
}
{
  const got = skipped('③-m') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : strictExitGate();
  if (typeof got === 'string'){
    console.log('⏸ 行为断言（严格模式退出码）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else if (got.defManual === 0){
    console.log('⏸ 行为断言（严格模式退出码）：探针没能造出「无 Chrome」场景（默认跑一个 ⏸ 都没有），此项需外部验证');
    manual++;
  } else if (got.defCode !== 0){
    console.log('✗ 行为断言（严格模式退出码）：无 Chrome 时**默认**必须仍然退出 0（CI 在 ubuntu 上就是这条路），实测退出码 ' + got.defCode); fail++;
  } else if (got.strictCode !== 2){
    console.log('✗ 行为断言（严格模式退出码）：--strict 下 manual > 0 必须退出 2，实测退出码 ' + got.strictCode +
      '（' + got.strictManual + ' 项未验证）'); fail++;
  } else if (!got.strictSaid){
    console.log('✗ 行为断言（严格模式退出码）：--strict 应打印一行「严格模式：N 项未在本机验证」，实测没打印'); fail++;
  } else {
    console.log('✓ 行为断言（严格模式退出码）：JC_CHROME 指向不存在路径时 —— 默认退出 ' + got.defCode +
      '（' + got.defManual + ' 项 ⏸）、--strict 退出 ' + got.strictCode + '（' + got.strictManual + ' 项未在本机验证，已打印说明）');
  }
}

/* --dump-dom 取回的 <title> 是 HTML 转义过的：hash 里的 & 会变成 &amp;。
   解析前必须还原（顺序：先 &quot; 再 &amp; —— 反过来会把 &amp;quot; 误还原成引号）。
   踩过一次：③-g 的 C 段其实已经返回 #topic=t5&q=…，却被误判成 ✗。 */
function decodeProbeTitle(s){
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/* ③-g 行为断言（2026-10-08 续 16 新增）：「← 返回」必须回到**来源视图**。
   来历：同类缺陷普查的 F3 —— `data-back` 一律 `state.term=null; updateHash()`，目标由 hashOf() 按当前
   state **推导**，而不是把来源记下来。实测（母版、1280×800）：收藏视图 → 开卡片 → 返回落到 `#topic=t1`
   （收藏丢了）；更新日志 → 点词条 → 返回落到 `#topic=t2`；搜索结果 → 开卡片 → 返回保住 `q` 但主题被改写成
   词条所属主题（t5→t1）。而**浏览器后退键三条都对** —— 因为那个走的是历史，不是推导。
   （续 15 修掉 F2 的状态残留后，更新日志那条从"碰巧回对"变回"回列表"，把 F3 暴露得更清楚。）
   判据（只看返回之后的 hash）：
     A 收藏视图 → 开卡片 → 返回 ：hash 必须仍是 `#topic=fav`
     B 更新日志 → 点词条 → 返回 ：hash 必须仍是 `#changelog`
     C 搜索结果 → 开卡片 → 返回 ：hash 必须保持来源主题与搜索词（`#topic=t5&q=…`），不得被改写成词条所属主题 */
function headlessBackSourceGate(){
  const TEMPLATE = path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var out = {};
  function report(){ document.title = 'BACKSRC_PROBE:' + JSON.stringify(out); }
  function stepA(){
    var star = document.querySelector('[data-fav]');
    if (star) star.click();
    setTimeout(function(){
      location.hash = '#topic=fav';
      setTimeout(function(){
        var card = document.querySelector('#topicView [data-card] .card-link');
        if (!card){ out.A = 'no-fav-card'; return stepB(); }
        tag = 'A'; next = stepB;
        card.click();
        setTimeout(function(){
          var b = document.querySelector('[data-back]'); if (!b){ out.A = 'no-back'; return next(); }
          b.click(); setTimeout(function(){ out.A = location.hash; stepB(); }, 700);
        }, 800);
      }, 700);
    }, 300);
  }
  function stepB(){
    location.hash = '#changelog';
    setTimeout(function(){
      var link = document.querySelector('#topicView .cl-term[href^="#term="]');
      if (!link){ out.B = 'no-cl-term'; return stepC(); }
      link.click();
      setTimeout(function(){
        var b = document.querySelector('[data-back]'); if (!b){ out.B = 'no-back'; return stepC(); }
        b.click(); setTimeout(function(){ out.B = location.hash; stepC(); }, 700);
      }, 800);
    }, 700);
  }
  function stepC(){
    location.hash = '#topic=t5';
    setTimeout(function(){
      var h3 = document.querySelector('#topicView [data-card] h3');
      if (!h3){ out.C = 'no-card'; return report(); }
      var kw = h3.textContent.trim().slice(0, 2);
      location.hash = '#topic=t5&q=' + encodeURIComponent(kw);
      setTimeout(function(){
        var card = document.querySelector('#topicView [data-card] .card-link');
        if (!card){ out.C = 'no-card-2'; return report(); }
        out.C_from = location.hash;
        card.click();
        setTimeout(function(){
          var b = document.querySelector('[data-back]'); if (!b){ out.C = 'no-back'; return report(); }
          b.click(); setTimeout(function(){ out.C = location.hash; report(); }, 700);
        }, 800);
      }, 700);
    }, 700);
  }
  function start(){ setTimeout(stepA, 500); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-backsrc-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=16000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>BACKSRC_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-g') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessBackSourceGate();
  if (got === null){
    console.log('⏸ 行为断言（返回来源）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（返回来源）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else {
    const bad = [];
    if (String(got.A).indexOf('fav') < 0) bad.push('A 收藏视图 → 返回落到 ' + got.A + '（应含 fav）');
    if (String(got.B) !== '#changelog') bad.push('B 更新日志 → 返回落到 ' + got.B + '（应回 #changelog）');
    if (!/^#topic=t5&q=/.test(String(got.C))) bad.push('C 搜索 → 返回落到 ' + got.C + '（应保持 #topic=t5&q=…）');
    if (String(got.A).indexOf('no-') === 0 || String(got.B).indexOf('no-') === 0 || String(got.C).indexOf('no-') === 0){
      console.log('⏸ 行为断言（返回来源）：探针场景没构造起来（' + JSON.stringify(got) + '），此项需外部验证');
      manual++;
    } else if (bad.length){
      console.log('✗ 行为断言（返回来源）：「← 返回」应回到来源视图 —— ' + bad.join('；')); fail++;
    } else {
      console.log('✓ 行为断言（返回来源）：收藏 → ' + got.A + '；更新日志 → ' + got.B + '；搜索 → ' + got.C + '（三条都回来源）');
    }
  }
}

/* ③-h 行为断言（2026-10-08 续 17 新增）：跨词条切换（上一条/下一条）必须「先归零、再做过渡」。
   来历：2026-10-08 参考站（https://vibe-hub.org/）实测 —— 它在开过渡**之前**就
   `scrollTo({top:0, behavior:'instant'})`（时序：scrollTo → 4ms 后 startViewTransition），
   因此两种快照在垂直方向对齐：参考站的 detail-body 组在整段过渡里 y 恒为 149（**垂直位移 0px**），
   只有左右滑动。我们引擎原先是在过渡回调（= 快照之后）才 `window.scrollTo(0,0)`，
   旧快照留在阅读位置，组要额外补间"你滚过的距离"（实测滚 100/200/239px → 斜向位移 100/200/239px），
   而且 >240px 直接被老守卫 `vtSkip` 砍掉动画（使用者明确要求动画保留）。
   判据（只看 startViewTransition 被调用那一刻，不看动画时序）：
     滚动 600px 后点「下一条」→ 必须①**真的开了过渡**（没被 vtSkip 砍掉）
     ②调用那一刻 scrollY 已经是 0（先归零）③dir=next ④名字里含 detail-body（水平滑动的挂点） */
function headlessAcrossGate(){
  const TEMPLATE = path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  var rec = { called: 0, scrollY: -1, dir: null, names: '' };
  function reset(){ rec = { called: 0, scrollY: -1, dir: null, names: '' }; }
  window.__reset = reset;
  var orig = document.startViewTransition;
  try {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, writable: true, value: function(){
      rec.called++;
      rec.scrollY = Math.round(window.scrollY);
      rec.dir = document.documentElement.getAttribute('data-dir');
      var all = document.querySelectorAll('*'), hit = [];
      for (var i = 0; i < all.length; i++){ var v = all[i].style && all[i].style.viewTransitionName; if (v) hit.push(v); }
      rec.names = hit.join(' | ');
      return orig.apply(document, arguments);
    }});
  } catch (e){}
  function report(){
    document.title = 'ACROSS_PROBE:' + JSON.stringify({ called: rec.called, scrollYAtCall: rec.scrollY,
      dir: rec.dir, names: rec.names, scrollBefore: window.__sb, hasNext: window.__hn });
  }
  function start(){
    var card = document.querySelector('[data-card] .card-link');
    if (!card){ document.title = 'ACROSS_PROBE:' + JSON.stringify({ err: 'no-card' }); return; }
    card.click();
    setTimeout(function(){
      var nx = document.querySelector('.float-nav.right[data-term]');
      window.__hn = !!nx;
      if (!nx){ document.title = 'ACROSS_PROBE:' + JSON.stringify({ err: 'no-next' }); return; }
      window.scrollTo(0, 600);
      setTimeout(function(){
        window.__sb = Math.round(window.scrollY);
        window.__reset();                       /* 只记「点下一条」这一次过渡（打开卡片那次已过去） */
        nx.click();
        setTimeout(report, 700);
      }, 250);
    }, 900);
  }
  if (document.readyState === 'complete') setTimeout(start, 500);
  else window.addEventListener('load', function(){ setTimeout(start, 500); });
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-across-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--virtual-time-budget=9000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>ACROSS_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-h') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessAcrossGate();
  if (got === null){
    console.log('⏸ 行为断言（跨词条过渡）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（跨词条过渡）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else if (got.err){
    console.log('⏸ 行为断言（跨词条过渡）：场景构造失败（' + got.err + '），此项需外部验证');
    manual++;
  } else if (got.called === 0){
    console.log('✗ 行为断言（跨词条过渡）：滚动 ' + got.scrollBefore + 'px 后点「下一条」**没有播过渡**（被 vtSkip 砍掉）—— 参考站在任何深度都保留横向滑动'); fail++;
  } else if (got.scrollYAtCall !== 0){
    console.log('✗ 行为断言（跨词条过渡）：开过渡前没有先归零 —— startViewTransition 被调用时 scrollY=' + got.scrollYAtCall +
      '（参考站是 0；否则快照垂直错位、位移 = 滚动深度）'); fail++;
  } else if (got.dir !== 'next'){
    console.log('✗ 行为断言（跨词条过渡）：方向应为 next，实测 dir=' + got.dir); fail++;
  } else if (String(got.names).indexOf('detail-body') < 0){
    console.log('✗ 行为断言（跨词条过渡）：水平滑动的挂点 detail-body 没挂上，实测 names=' + got.names); fail++;
  } else {
    console.log('✓ 行为断言（跨词条过渡）：滚动 ' + got.scrollBefore + 'px 后点「下一条」→ 仍播过渡、调用时 scrollY 已是 0、dir=next、挂点 ' + got.names + '（照参考站：先归零再过渡）');
  }
}

/* ③-i 行为断言（2026-10-08 续 18 新增）：侧栏「分类」高亮的判定阈值不能卡在 scroll-margin 边界上。
   来历：使用者手机端报障「点第 4 个主题，背景色却亮在第 3 个」。实测（375×667 触屏 / DSF 3）——
   那是抽屉里的**分类**列表（点它不关抽屉，与"连点 1→2→4"的动作一致）：
     分节 CSS：`scroll-margin-top: calc(var(--nav-h) + 28px)` = 88px  → scrollIntoView 把它**精确停在 88px**
     滚动侦测：写死 `top <= 88`
   两者相等 ⇒ 判等由**亚像素**决定：手机上落在 88.33 就判 false，高亮停在**上一个**分节
   （母版实测：点第 2 个分类 → 分节 top=88、高亮却仍是第 1 个）。
   判据：把某个分节停在 90px（scroll-margin 88 与旧阈值 88 之间、新阈值 96 之内），高亮必须跟着它走。 */
function headlessCatSpyGate(){
  /* 侧栏在 ≤860 会变抽屉、关闭时 #catList 是 hidden（syncCatActive 直接早退）——
     所以这一项必须在大窗口下跑，否则量到的是初始高亮而不是滚动侦测的结果（会假红/假绿）。
     JC_TEMPLATE 只在本地做「红绿对照」时用来指向改前副本，CI 与日常一律走默认母版。 */
  const TEMPLATE = process.env.JC_TEMPLATE ? path.resolve(process.env.JC_TEMPLATE) : path.join(ROOT, 'templates', '词条图鉴模板-v5.html');
  let html;
  try { html = fs.readFileSync(TEMPLATE, 'utf8'); } catch (e){ return 'SKIP:读不到 templates/词条图鉴模板-v5.html'; }
  const probe = `
<script>(function(){
  function report(o){ document.title = 'CATSPY_PROBE:' + JSON.stringify(o); }
  function onIdx(){ var bs = document.querySelectorAll('#catList .side-cat'), o = [];
    for (var i = 0; i < bs.length; i++) if (bs[i].classList.contains('on')) o.push(i);
    return o.length === 1 ? o[0] : (o.length ? 'multiple' : -1); }
  function start(){
    var secs = document.querySelectorAll('#topicView [data-catsec]');
    var btns = document.querySelectorAll('#catList .side-cat');
    if (secs.length < 2 || btns.length < 2){ report({ err: 'sections=' + secs.length + ',btns=' + btns.length }); return; }
    var chip = document.querySelector('#topicChips .topic-chip[aria-pressed="true"]') || document.querySelector('#topicChips .topic-chip');
    if (!chip){ report({ err: 'no-chip' }); return; }
    var topic = chip.getAttribute('data-topic');
    /* ⚠️ 先把 hash 落到目标主题：否则后面点芯片会「updateHash 里换 hash」+「hashchange」触发**两次**渲染，
       第二次渲染发生在 scrollTo(0,0) 之后，会把侦测结果清掉 —— 闸门就永远读不到中间那一次。
       hash 已在目标上时 updateHash() 只会 renderApp() 一次，侦测在"我们设好的滚动位置"上跑完即定局。 */
    if (location.hash !== '#topic=' + topic){ location.hash = '#topic=' + topic; setTimeout(run, 900); }
    else run();
    function run(){
      var secs = document.querySelectorAll('#topicView [data-catsec]');
      /* ⚠️ 芯片要重新取：上面那次导航重渲了侧栏，旧引用已脱离 DOM（点它不会冒泡到 document） */
      var chip2 = document.querySelector('#topicChips .topic-chip[aria-pressed="true"]') || document.querySelector('#topicChips .topic-chip');
      if (!chip2){ report({ err: 'no-chip-2' }); return; }
      var se = document.scrollingElement, max = se.scrollHeight - innerHeight;
      var target = -1, sec = null, need = -1;
      for (var k = secs.length - 1; k >= 0; k--){
        var rr = secs[k].getBoundingClientRect();
        var nd = window.scrollY + rr.top - 90;     /* 90px：稳稳落在旧阈值 88 与新阈值 96 之间 */
        if (nd >= 0 && nd <= max + 1){ target = k; sec = secs[k]; need = nd; break; }
      }
      if (!sec){ report({ err: 'no-placeable-section', maxScroll: Math.round(max) }); return; }
      window.scrollTo(0, need);
      var topAtSpy = sec.getBoundingClientRect().top;   /* 立刻量：这就是侦测函数将看到的输入 */
      /* ⚠️ 这一项不能靠滚动事件驱动：--virtual-time-budget 下 rAF 只跑一次、scroll 事件不触发
         （实测 ticks=1 / scrollEvents=0），挂在 scroll+rAF 上的 syncCatActive 在闸门里不会跑。
         改借 renderTopicView() 末尾那次**同步**调用（点当前主题芯片触发一次重渲）。 */
      chip2.click();
      setTimeout(function(){
        report({ top: Math.round(topAtSpy * 100) / 100, on: onIdx(), target: target, btns: btns.length,
          margin: getComputedStyle(sec).scrollMarginTop, scrollYAfter: Math.round(window.scrollY) });
      }, 700);
    }
  }
  if (document.readyState === 'complete') setTimeout(start, 500);
  else window.addEventListener('load', function(){ setTimeout(start, 500); });
})();<\/script>`;
  const tmp = path.join(os.tmpdir(), 'jc-catspy-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('</body>', probe + '</body>'), 'utf8');
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=1280,600', '--virtual-time-budget=9000', '--dump-dom',
    pathToFileURL(tmp).href], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = r.stdout || '';
  try { fs.unlinkSync(tmp); } catch (e){}
  if (r.error && dom.length === 0) return null;
  const m = dom.match(/<title>CATSPY_PROBE:([^<]*)<\/title>/);
  if (!m) return 'SKIP:未抓到探针（Chrome 输出 ' + dom.length + ' 字符）';
  try { return JSON.parse(decodeProbeTitle(m[1])); } catch (e){ return 'SKIP:探针结果解析失败（' + m[1] + '）'; }
}
{
  const got = skipped('③-i') ? 'SKIP:JC_SKIP 指定跳过（分小批跑）' : headlessCatSpyGate();
  if (got === null){
    console.log('⏸ 行为断言（分类高亮跟随）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else if (typeof got === 'string'){
    console.log('⏸ 行为断言（分类高亮跟随）：' + got.slice(5) + '，此项需外部验证');
    manual++;
  } else if (got.err){
    console.log('⏸ 行为断言（分类高亮跟随）：母版示例里只有 ' + got.err + '，场景构造不出来，此项需外部验证');
    manual++;
  } else if (got.on === 'multiple' || Math.abs(got.top - 90) > 1.5){
    console.log('⏸ 行为断言（分类高亮跟随）：没能把分节停在 90px（实测 top=' + got.top + '），此项需外部验证');
    manual++;
  } else if (got.on !== got.target){
    console.log('✗ 行为断言（分类高亮跟随）：分节停在 top=' + got.top + '（scroll-margin=' + got.margin +
      '）时，高亮应落在第 ' + (got.target + 1) + ' 个分类，实测落在第 ' + (got.on + 1) + ' 个 —— 与使用者手机端「点第 4 个亮第 3 个」同源（阈值卡在边界上）'); fail++;
  } else {
    console.log('✓ 行为断言（分类高亮跟随）：分节停在 top=' + got.top + '（scroll-margin=' + got.margin +
      '）时高亮落在第 ' + (got.on + 1) + ' 个分类 —— 阈值与 scroll-margin 同源、不再卡边界');
  }
}

if (fail === 0 && manual === 0) console.log('=== 校验全部通过 ===');
else if (fail === 0) console.log('=== 校验通过；另有 ' + manual + ' 项无法在本进程启动 Chrome，须按上方命令外部验证并核对「0 错误 · 0 警告」 ===');
else console.log('=== ' + fail + ' 项未过 ===');
/* v1.1.5（续 20 修复·F8）：退出码三分 —— 0 全绿 / 1 有硬失败 / 2 严格模式下有未在本机验证的项。
   默认行为与 v1.1.4 完全一致（manual > 0 仍是 0），所以 ubuntu CI 不受影响；
   要「退出码 0 就等于真检过」就加 --strict（或 JC_STRICT=1）。 */
if (STRICT && fail === 0 && manual > 0){
  console.log('严格模式：' + manual + ' 项未在本机验证（本进程起不了 Chrome）——退出码 2（非 1：不是检失败，是没检成）');
  process.exit(2);
}
process.exit(fail === 0 ? 0 : 1);
