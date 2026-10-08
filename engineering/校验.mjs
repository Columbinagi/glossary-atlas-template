/* ============================================================
   engineering/校验.mjs —— 交付前自检：知识库 md 可解析 + 产物内联 JS + #debug 报告
   用法：node engineering/校验.mjs   （先跑 engineering/拼合.mjs 再跑本脚本）
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
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
headlessDebug('#debug', '#debug');
headlessDebug('#debug&lang=en', '#debug&lang=en');

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
  const got = headlessPracticeProgress();
  if (got === null){
    console.log('⏸ 行为断言（自测进度数字）：本进程无法启动 Chrome，此项需外部验证');
    manual++;
  } else {
    const m = got.match(/已会\s*(\d+)\s*\/\s*(\d+)/);
    if (m && m[1] === '1' && Number(m[2]) >= 1) console.log('✓ 行为断言：判 1 张「会了」后进度数字 = ' + got);
    else { console.log('✗ 行为断言：判 1 张「会了」后进度数字应为「已会 1 / N（N≥1）」，实测「' + got + '」'); fail++; }
  }
}

if (fail === 0 && manual === 0) console.log('=== 校验全部通过 ===');
else if (fail === 0) console.log('=== 校验通过；另有 ' + manual + ' 项无法在本进程启动 Chrome，须按上方命令外部验证并核对「0 错误 · 0 警告」 ===');
else console.log('=== ' + fail + ' 项未过 ===');
process.exit(fail === 0 ? 0 : 1);
