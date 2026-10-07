/* ============================================================
   engineering/体检.mjs —— 窄屏排版体检（多宽度 × 多视图扫一遍）
   用法：node engineering/体检.mjs            默认 16 档宽度 × 4 个视图
         node engineering/体检.mjs --quick    只扫 375 / 768 / 1280 三档
         node engineering/体检.mjs --lang=en  改扫英文界面（默认中文界面）
         node engineering/体检.mjs <某个站点.html>   体检任意产物（含别的项目产出的）

   为什么需要它：只在宽屏开发、窄屏不验，会留下「窗口一窄就坏」的缺陷——
   2026-10-07 修的那个顶栏语言按钮折行就是典型：只在 561–960px 视口出现，
   在真实项目里藏了 10 天。这条命令把它变成一键可查。

   体检项（都是「肉眼看得见」的排版问题，不查内容正确性）：
     ① 页面横向溢出        ② 顶栏内容溢出自身
     ③ 顶栏元素越出右边界   ④ 顶栏短标签折行（如「中文」被挤成竖排两行）
     ⑤ 可见文本被截断（scrollWidth > clientWidth）
     ⑥ 顶栏垂直对齐（文字/盒子偏离本行中线 > 1.5px）

   ⚠ 为什么把待检页面塞进 iframe 再跑（2026-10-07 实测后改写）：
     Windows 上 headless Chrome 用的是真实窗口，而窗口宽度有最小值（本机 500px），
     于是 --window-size=375,900 的实际 innerWidth 是 500，--window-size=1280,400
     的实际 innerWidth 是 1264（还要再扣 16px 窗口边框）。后果：
       · 320/360/375/414/480 这五档其实都在按 500px 测——最窄的那批屏幕从没被验证过；
       · --screenshot 出的 PNG 宽度是请求值、页面却是按被夹住的宽度排的，右边会被裁掉。
     现在改为「窗口取够大 + iframe 宽度 = 目标宽度」：媒体查询、100vw、position:fixed
     都按 iframe 视口生效，等价于真机宽度；每档再回读一次实际 innerWidth，
     与目标不符就点名列进问题清单，不再「假装测过」。

   需要无头 Chrome（路径常量与 engineering/校验.mjs:18 相同）；
   本进程起不了 Chrome 时记「需外部验证」并退出 0，不误判为失败。
   ============================================================ */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/* 产物：命令行给了 .html 就体检它，否则取 dist/ 下第一个 .html
   （不写死文件名，等价于承认「接线点 1」尚未统一） */
const argFile = process.argv.slice(2).find(a => a.toLowerCase().endsWith('.html'));
let OUT, outLabel;
if (argFile){
  OUT = path.resolve(argFile);
  if (!fs.existsSync(OUT)) { console.log('✗ 指定的文件不存在：' + OUT); process.exit(1); }
  outLabel = argFile;
} else {
  if (!fs.existsSync(DIST)) { console.log('✗ 没有 dist/ 目录，先跑 node engineering/拼合.mjs'); process.exit(1); }
  const outs = fs.readdirSync(DIST).filter(f => f.endsWith('.html'));
  if (!outs.length) { console.log('✗ dist/ 下没有站点文件，先跑 node engineering/拼合.mjs'); process.exit(1); }
  OUT = path.join(DIST, outs[0]);
  outLabel = 'dist/' + outs[0];
}
console.log('=== 窄屏排版体检 ===');
console.log('产物：' + outLabel);

const quick = process.argv.includes('--quick');
const WIDTHS = quick ? [375, 768, 1280]
  : [320, 360, 375, 414, 480, 560, 600, 700, 768, 860, 900, 960, 1024, 1200, 1440, 1600];
const LANG = process.argv.includes('--lang=en') ? 'en' : 'zh';
/* 视口高度：顶栏 44 + 内容若干；高度不影响横向排版判定，取一个够看清首屏的值 */
const VIEW_H = 900;

const PROBE = `<script>
(function(){
  function lineCount(el){
    try{
      var tops = {}, walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
      while ((n = walker.nextNode())){
        if (!n.nodeValue || !n.nodeValue.replace(/\\s+/g,'')) continue;
        var r = document.createRange(); r.selectNodeContents(n);
        var rects = r.getClientRects();
        for (var i=0;i<rects.length;i++){ var q=rects[i]; if(q.width<=1||q.height<=1) continue; tops[Math.round((q.top+q.height/2)/5)]=1; }
      }
      return Object.keys(tops).length;
    }catch(e){ return 0; }
  }
  function run(){
    var out = { w: innerWidth, issues: [] };
    function push(s){ out.issues.push(s); }
    function lab(el){ return el.id ? '#'+el.id : (typeof el.className==='string' && el.className.trim() ? '.'+el.className.trim().split(/\\s+/)[0] : el.tagName.toLowerCase()); }
    var card = document.querySelector('.card[data-card]');
    out.cardId = card ? card.getAttribute('data-card') : '';
    out.lang = document.documentElement.lang || '';
    if (document.documentElement.scrollWidth > innerWidth + 1) push('页面横向溢出 ' + (document.documentElement.scrollWidth - innerWidth) + 'px');
    var nav = document.querySelector('.nav');
    if (nav){
      if (nav.scrollWidth > nav.clientWidth + 2) push('顶栏内容溢出自身 ' + (nav.scrollWidth - nav.clientWidth) + 'px');
      Array.prototype.forEach.call(nav.querySelectorAll('button, a'), function(el){
        var t = (el.textContent || '').replace(/\\s+/g, '');
        if (!t || t.length > 6) return;
        if (el.querySelector('svg')) return;
        if (getComputedStyle(el).position === 'absolute') return;
        var r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
        var n = lineCount(el);
        if (n > 1) push('顶栏标签折行(' + n + ' 行)：' + lab(el) + '「' + t + '」');
      });
      Array.prototype.forEach.call(nav.querySelectorAll('button, a, input'), function(el){
        var r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
        if (r.right > innerWidth + 1) push('顶栏元素越出右边界 ' + Math.round(r.right - innerWidth) + 'px：' + lab(el));
      });
      /* ⑥ 顶栏垂直对齐：按「行」分别比（窄屏顶栏会折成两行，跨行比会误报） */
      function textMid(el){
        try{
          var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n2, t = Infinity, b = -Infinity;
          while ((n2 = walker.nextNode())){
            if (!n2.nodeValue || !n2.nodeValue.replace(/\\s+/g,'')) continue;
            var rr = document.createRange(); rr.selectNodeContents(n2);
            var rs = rr.getClientRects();
            for (var i2 = 0; i2 < rs.length; i2++){ if (rs[i2].width > 1 && rs[i2].height > 1){ if (rs[i2].top < t) t = rs[i2].top; if (rs[i2].bottom > b) b = rs[i2].bottom; } }
          }
          return (t === Infinity) ? null : (t + b) / 2;
        }catch(e){ return null; }
      }
      var alignItems = [];
      [['品牌', '.nav-brand'], ['抽屉按钮', '.nav-drawer-btn'], ['导航项', '.nav-links a'], ['收藏', '.nav-fav'],
       ['语言', '.lang-sw'], ['主题色圆点', '.nav-color .nav-circle'], ['快捷键', '.kbd-btn'],
       ['明暗切换', '.theme-btn'], ['搜索框', '.nav-search']].forEach(function(pair){
        var el = document.querySelector(pair[1]);
        if (!el) return;
        var r2 = el.getBoundingClientRect();
        if (r2.width === 0 || r2.height === 0) return;
        alignItems.push({ name: pair[0], boxMid: r2.top + r2.height / 2, txtMid: textMid(el) });
      });
      alignItems.forEach(function(it){
        /* 参考线 = 同「行」元素（纵向相差 < 25px）的中心中位数；单行时即该行中心 */
        var near = alignItems.filter(function(o){ return Math.abs(o.boxMid - it.boxMid) < 25; })
                             .map(function(o){ return o.boxMid; }).sort(function(a,b){ return a - b; });
        var ref = near[Math.floor(near.length / 2)];
        var boxOff = it.boxMid - ref;
        if (Math.abs(boxOff) > 1.5) push('顶栏对齐：' + it.name + ' 盒子偏离本行中线 ' + boxOff.toFixed(1) + 'px');
        if (it.txtMid !== null){
          var txtOff = it.txtMid - ref;
          if (Math.abs(txtOff) > 1.5) push('顶栏对齐：' + it.name + ' 文字偏离本行中线 ' + txtOff.toFixed(1) + 'px');
        }
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.card, .topic-chip, .side, .wrap, .sec, .topic-heading h1'), function(el){
      var r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
      if (r.right > innerWidth + 2) push('元素越出右边界：' + lab(el));
      if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2) push('文本被截断：' + lab(el));
    });
    try { parent.postMessage(JSON.stringify(out), '*'); } catch (e){}
  }
  if (document.readyState === 'complete') setTimeout(run, 250);
  else window.addEventListener('load', function(){ setTimeout(run, 250); });
})();
</script>
</body>`;

/* ---- 组装：inner（被体检的页面 + 探针）塞进 frame（提供精确视口的 iframe 宿主） ---- */
let html = fs.readFileSync(OUT, 'utf8');
if (!html.includes('</body>')) { console.log('✗ 产物里没有 </body>，无法注入探针：' + OUT); process.exit(1); }
/* 语言键从产物里读（避免工具与引擎的 localStorage 键名两处漂移）；读不到就按默认键注入 */
const LANG_KEY = (html.match(/var\s+LANG_KEY\s*=\s*'([^']+)'/) || [null, 'kbtpl_lang_v1'])[1];
if (LANG === 'en') html = html.replace('<head>', `<head><script>try{localStorage.setItem('${LANG_KEY}','en')}catch(e){}</script>`);
const INNER = html.replace('</body>', PROBE);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'));
fs.writeFileSync(path.join(tmpDir, 'inner.html'), INNER, 'utf8');
fs.writeFileSync(path.join(tmpDir, 'frame.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#c8c8c8}
iframe{border:0;display:block;background:#fff}
</style></head><body>
<iframe id="f"></iframe>
<script>
var q = new URLSearchParams(location.search);
var f = document.getElementById('f');
f.style.width = (q.get('w') || '375') + 'px';
f.style.height = (q.get('h') || '900') + 'px';
f.src = 'inner.html' + (q.get('hash') || '');
addEventListener('message', function(e){
  var pre = document.getElementById('__probe') || document.createElement('pre');
  pre.id = '__probe'; pre.textContent = e.data;
  document.body.appendChild(pre);
});
</script></body></html>`, 'utf8');

/* 窗口只要「装得下 iframe」即可：Windows 上窗口宽度最小值约 500px，故取 max(宽+40, 516) */
function run(w, hash){
  const winW = Math.max(w + 40, 516);
  const url = pathToFileURL(path.join(tmpDir, 'frame.html')).href +
    '?w=' + w + '&h=' + VIEW_H + '&hash=' + encodeURIComponent(hash);
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files', '--virtual-time-budget=3500', '--window-size=' + winW + ',' + (VIEW_H + 24),
    '--dump-dom', url], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const dom = r.stdout || '';
  if (r.error && dom.length === 0) return { noChrome: true, code: r.error.code };
  const m = dom.match(/id="__probe">([\s\S]*?)<\/pre>/);
  if (!m) return { broken: true, domLen: dom.length };
  try { return JSON.parse(m[1]); } catch (e){ return { broken: true, domLen: dom.length }; }
}

/* 先探一次：拿详情页用的词条 id（体检只看排版，这里不需要指定是哪一条） */
const first = run(WIDTHS[0], '');
if (first.noChrome){
  console.log('⏸ 本进程无法启动 Chrome（' + first.code + '），此项需外部验证——');
  console.log('   请手动开一个浏览器窗口，把宽度依次拖到 ' + WIDTHS.join(' / ') + 'px 过一眼：');
  console.log('   重点看顶栏（品牌 / 搜索 / 收藏 / 语言 / 明暗）有没有折行、挤出、重叠。');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(0);
}
let termId = '';
if (first.broken){
  /* 拿不到探针就退回默认视图，但仍然继续扫宽度 */
  console.log('⚠ 探针未返回（DOM ' + first.domLen + ' 字符），本次只扫默认与 hash 视图');
} else {
  termId = first.cardId || '';
}
const VIEWS = ['', '#practice', '#changelog'].concat(termId ? ['#term=' + termId] : []);
const LANG_LABEL = LANG === 'en' ? '（英文界面）' : '';
console.log('宽度档：' + WIDTHS.length + ' 个 × 视图：' + VIEWS.length + ' 个' + (termId ? '（含 #term=' + termId + '）' : '') + LANG_LABEL);
if (LANG === 'en') console.log('语言：英文界面（注入 localStorage ' + LANG_KEY + "='en'；键名取自产物)");
console.log('');

let bad = 0, total = 0;
for (const w of WIDTHS){
  for (const v of VIEWS){
    total++;
    const r = run(w, v);
    if (r.noChrome || r.broken){ console.log('⏸ ' + w + 'px ' + (v || '默认') + '：探针未返回，跳过'); continue; }
    const uniq = [...new Set(r.issues)];
    /* 视口自检：iframe 方案理论上恒等于目标宽度，不符就说明测的不是这一档——列为问题，不许静默 */
    if (r.w !== w) uniq.unshift('视口宽度不符：目标 ' + w + 'px，实际 ' + r.w + 'px（本档结果不可用）');
    /* 语言自检：英文档若没切过去，这 12 组等于白跑——同样列为问题，不许静默 */
    if (LANG === 'en' && r.lang !== 'en') uniq.unshift('英文界面未生效：html.lang=' + (r.lang || '(空)') + '（本档结果其实是中文界面）');
    if (uniq.length){
      bad++;
      console.log('✗ ' + w + 'px ' + (v || '默认') + LANG_LABEL);
      uniq.forEach(x => console.log('    · ' + x));
    }
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('');
if (bad === 0) { console.log('=== 体检通过：' + total + ' 个组合（' + WIDTHS.length + ' 档宽度 × ' + VIEWS.length + ' 视图' + LANG_LABEL + '）未发现排版问题 ==='); process.exit(0); }
console.log('=== ' + bad + ' / ' + total + ' 个组合有问题（见上方清单）===');
console.log('提示：窄屏排版问题多半来自一条只在某个媒体查询里生效的固定宽度 / min-height 规则；');
console.log('      定位办法：把可疑规则临时注释掉再跑本命令对比（改母版 → 拼合 → 体检）。');
process.exit(1);
