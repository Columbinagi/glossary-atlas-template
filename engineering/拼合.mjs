/* ============================================================
   engineering/拼合.mjs —— 把「content/」数据源合入母版引擎，产出站点唯一文件
   用法：node engineering/拼合.mjs
   权威源（2026-09-19 21:10 起）= content/知识库/*.md（Markdown 知识库）；
   content/站点配置.js 是站点级配置。产物数据区勿手改（会被下次拼合覆盖）。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { parseKnowledgeDir, serializeTerms, parseChangelogMd } from './lib-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* v2（批次 1）：默认母版切到 v6；v5 保留作回退（JC_TEMPLATE 可指回 v5） */
const TEMPLATE = process.env.JC_TEMPLATE ? path.resolve(process.env.JC_TEMPLATE) : path.join(ROOT, 'templates', '词条图鉴模板-v6.html');
const CONTENT_DIR = path.join(ROOT, 'content');
const KB_DIR = path.join(CONTENT_DIR, '知识库');
const KB_EN_DIR = path.join(CONTENT_DIR, '知识库-en');
const OUT = path.join(ROOT, 'dist', '新能源汽车知识图鉴.html');

const MARK_CFG = '/* ================== 模块配置区：接入时必改 ================== */';
const MARK_ENG = '/* ================== 引擎（以下无需改动） ================== */';

/* 引擎头尾来自母版（默认 v6；JC_TEMPLATE 可指回 v5 做红绿对照） */
const tpl = fs.readFileSync(TEMPLATE, 'utf8');
const pCfg = tpl.indexOf(MARK_CFG), pEng = tpl.indexOf(MARK_ENG);
if (pCfg < 0 || pEng < 0 || pEng < pCfg) throw new Error('母版标记定位失败');
const head = tpl.slice(0, pCfg);
const tail = tpl.slice(pEng);

/* 站点配置（SITE_META / TOPICS / DEFAULT_TOPIC / CATEGORIES） */
/* 数据区截取（2026-09-26 修正）：取「开始标记行行尾 → 结束标记行行首」。
   原写法以「第一个注释结束符 + 箭头串」为起终点，终点会落在结束标记行内部，
   把半截未闭合注释截进数据——此前仅因下游紧跟注释块而未炸（潜伏脆弱性） */
function sliceDataBlock(raw, name){
  const a = raw.indexOf('↓↓↓↓↓↓'), b = raw.indexOf('↑↑↑↑↑↑');
  if (a < 0 || b < 0) throw new Error(name + ' 缺少数据区原文标记');
  const start = raw.indexOf('\n', a) + 1;          // 开始标记行行尾
  const end = raw.lastIndexOf('\n/*', b) + 1;      // 结束标记行行首（lastIndexOf 取距 b 最近者，数据体内更早的块注释不受影响）
  if (end <= start) throw new Error(name + ' 数据区标记顺序异常');
  return raw.slice(start, end).replace(/\r\n/g, '\n');
}

/* 站点配置（SITE_META / TOPICS / DEFAULT_TOPIC / CATEGORIES） */
const cfgFile = path.join(CONTENT_DIR, '站点配置.js');
if (!fs.existsSync(cfgFile)) throw new Error('缺少 content/站点配置.js');
const cfg = sliceDataBlock(fs.readFileSync(cfgFile, 'utf8'), '站点配置.js');

/* 更新日志（2026-09-27 起权威源 = content/更新日志.md，使用者拍板「上线流程对齐行业常规」）：
   人写 Markdown（Keep a Changelog 风格适配版）→ parseChangelogMd 解析 → 注入站点。
   格式约定见 engineering/lib-md.mjs parseChangelogMd；可缺，缺则 CHANGELOG = null（视图显示空态）。
   沿革：2026-09-26 初版为 content/更新日志.js（数据文件直读），md 管线切换时原 js 已删（Git 可溯） */
const clMdFile = path.join(CONTENT_DIR, '更新日志.md');
let cl = 'var CHANGELOG = null;';
let clCount = 0;
if (fs.existsSync(clMdFile)){
  const clEntries = parseChangelogMd(fs.readFileSync(clMdFile, 'utf8'));
  clCount = clEntries.length;
  cl = '/* ================== 更新日志数据（本段由 engineering/拼合.mjs 从 content/更新日志.md 解析生成，勿手改；格式约定见 engineering/lib-md.mjs parseChangelogMd）================== */\n' +
    'var CHANGELOG = ' + JSON.stringify(clEntries) + ';';
}

/* 更新日志英文镜像（2026-09-29 起 = content/更新日志-en.md，可缺；与中文按「日期 + 同日序号」逐条对齐，
   引擎 en 模式逐条覆盖、缺条回退中文；维护规则见文件头注释与 engineering/校验.mjs 的对齐闸门） */
const clEnMdFile = path.join(CONTENT_DIR, '更新日志-en.md');
let clEn = 'var CHANGELOG_EN = null;';
let clEnCount = 0;
if (fs.existsSync(clEnMdFile)){
  const clEnEntries = parseChangelogMd(fs.readFileSync(clEnMdFile, 'utf8'));
  clEnCount = clEnEntries.length;
  clEn = '/* ================== 更新日志英文数据（本段由 engineering/拼合.mjs 从 content/更新日志-en.md 解析生成，勿手改；与中文按「日期 + 同日序号」对齐）================== */\n' +
    'var CHANGELOG_EN = ' + JSON.stringify(clEnEntries) + ';';
}

/* 知识库 Markdown → 结构化词条 → 数据区文本
   中文分册为权威源；英文分册（content/知识库-en/）可缺，缺则 KB_TERMS_EN = null（引擎自动回退中文） */
const terms = parseKnowledgeDir(KB_DIR);
const termsEn = parseKnowledgeDir(KB_EN_DIR, { optional: true, allowStageLess: true });
const kb =
  '/* ================== 词条数据（本段由 engineering/拼合.mjs 从 content/知识库/*.md 自动生成，勿手改）==================\n' +
  '   知识库权威源 = content/知识库/*.md（中文）+ content/知识库-en/*.md（英文，可缺）；字段契约与写作纪律见 content/内容规范.md */\n' +
  serializeTerms(terms) + '\n' +
  (termsEn.length ? serializeTerms(termsEn, 'KB_TERMS_EN') : 'var KB_TERMS_EN = null;');

/* —— 本项目补丁：静态分享卡元数据（2026-10-08 立；2026-10-25 v2 重建时在 v6 基底上重写，非旧码贴回）——
   为什么需要：链接被分享到微信 / 飞书 / X / Slack 时，抓取方不执行 JS、只读 <head> 里的静态标签，
   母版的 <title>词条图鉴模板</title> 只是占位。这里按 SITE_META 生成真标题 ＋ description / og / twitter
   共 10 个静态标签，让分享出去的预览卡有标题、有描述。
   · og:image 有意留空：单文件形态下图片只能内联成 data-URI，抓取方不取；要图必须先有托管 URL。
   · 全部是静态文本，不产生任何外部请求——零外部请求红线不受影响。
   · 与引擎运行时 document.title 分工：这里管「分享出去长什么样」，引擎管「浏览器标签页里长什么样」。
   ⚠ 上游无此块：骨架同步时保留本地版（分叉登记见 CONTRACT.md §四）。 */
const cfgCtx = {};
vm.createContext(cfgCtx);
vm.runInContext(cfg, cfgCtx, { filename: 'content/站点配置.js（数据区）' });
const SM = cfgCtx.SITE_META || {};
const TOPIC_N = (cfgCtx.TOPICS || []).length;
function escMeta(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const BRAND = SM.brandName || SM.pageTitle || '';
if (!BRAND) throw new Error('SITE_META 缺 brandName / pageTitle，无法生成静态分享卡元数据');
const DESC = BRAND + (SM.brandTagline ? ' · ' + SM.brandTagline : '') +
  ' —— ' + TOPIC_N + ' 个主题 · ' + terms.length + ' 张卡片，单文件离线可用的学习图鉴';
const SHARE_HEAD =
  '<!-- 静态分享卡元数据：由 engineering/拼合.mjs 按 SITE_META 生成（抓取方不执行 JS，故必须静态写在 head 里；勿手改） -->\n' +
  '<title>' + escMeta(BRAND) + '</title>\n' +
  '<meta name="description" content="' + escMeta(DESC) + '">\n' +
  '<meta property="og:type" content="website">\n' +
  '<meta property="og:site_name" content="' + escMeta(BRAND) + '">\n' +
  '<meta property="og:title" content="' + escMeta(BRAND) + '">\n' +
  '<meta property="og:description" content="' + escMeta(DESC) + '">\n' +
  '<meta property="og:locale" content="zh_CN">\n' +
  '<meta property="og:locale:alternate" content="en_US">\n' +
  '<meta name="twitter:card" content="summary">\n' +
  '<meta name="twitter:title" content="' + escMeta(BRAND) + '">\n' +
  '<meta name="twitter:description" content="' + escMeta(DESC) + '">';
const TITLE_RE = /<title>[^<]*<\/title>/;
const titleHits = head.match(new RegExp(TITLE_RE.source, 'g'));
if (!titleHits || titleHits.length !== 1){
  throw new Error('母版 head 里 <title> 不是恰好 1 处（实为 ' + (titleHits ? titleHits.length : 0) + ' 处），拒绝注入分享卡元数据');
}
const headOut = head.replace(TITLE_RE, SHARE_HEAD);

const out = headOut + cfg + '\n' + cl + '\n' + clEn + '\n' + kb + tail;
fs.writeFileSync(OUT, out);
console.log('拼合完成 →', OUT);
console.log('  权威源：content/知识库/*.md（' + terms.length + ' 条词条）+ content/站点配置.js + content/更新日志.md（' + clCount + ' 条）');
console.log('  更新日志英文：' + (clEnCount ? 'content/更新日志-en.md（' + clEnCount + ' 条）' : '无 → CHANGELOG_EN = null'));
console.log('  英文分册：content/知识库-en/*.md（' + (termsEn.length ? termsEn.length + ' 条' : '无 → KB_TERMS_EN = null') + '）');
console.log('  引擎：  ' + path.basename(TEMPLATE) + '（head ' + headOut.length + ' + 数据 ' + (cfg.length + kb.length) + ' + tail ' + tail.length + ' = ' + out.length + ' 字符）');
console.log('  分享卡： <title>' + BRAND + '</title> ＋ description / og / twitter 共 10 个静态标签（og:image 有意留空：单文件形态取不到）');
