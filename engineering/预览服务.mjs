#!/usr/bin/env node
// ============================================================
// 预览服务.mjs · 本地静态预览服务（零依赖，仅 Node 内置模块）
//
// 为什么需要它：
//   Trae 内置浏览器出于安全策略，禁止导航到 file:// 地址
//   （实测报错：「Navigation to 'file' URLs is not allowed for security
//    reasons. Only http:// and https:// URLs are supported.」），
//   所以本地 HTML 要在 Trae 里预览，得经 http://localhost 起一个服务。
//
// 用法（在项目根目录执行）：
//   node engineering/预览服务.mjs                       # 默认：服务本项目，端口 8123
//   node engineering/预览服务.mjs 8124                  # 换端口
//   node engineering/预览服务.mjs "D:\某文件夹"          # 服务任意文件夹（如"每日资讯"那类 HTML 目录）
//   node engineering/预览服务.mjs 8124 "D:\某文件夹"     # 端口 + 文件夹都指定
//   然后按住 Ctrl 点击终端里打印的 http://localhost:端口/ 链接即可。
//   （需把「设置 → 通用 → 偏好设置 → 本地链接的默认打开方式」设为「内置浏览器」）
//
// 说明：访问 "/" 时优先返回 index.html 或站点文件，没有则给出目录列表；
//       服务只绑定 127.0.0.1，仅本机可访问。
// ============================================================

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = process.argv.slice(2);
const PORT = Number(ARGS.find((a) => /^\d+$/.test(a))) || 8123; // 纯数字参数 = 端口
const DIR_ARG = ARGS.find((a) => !/^\d+$/.test(a)); // 其余参数 = 要服务的文件夹
const PROJECT_ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..')); // engineering/ 的上一级 = 项目根
const ROOT = DIR_ARG ? resolve(DIR_ARG) : PROJECT_ROOT; // 服务根目录：默认本项目，也可指向任意文件夹
const HOME_FILES = ['index.html', 'dist/新能源汽车知识图鉴.html']; // 访问 "/" 时优先返回的文件

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 目录列表页：文件夹里没有 index.html 时，用它把所有文件列出来点着看
async function listing(dir, urlPath) {
  const items = await readdir(dir, { withFileTypes: true });
  const rows = items
    .filter((it) => !it.name.startsWith('.'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh'))
    .map((it) => {
      const base = urlPath.replace(/\/?$/, '/');
      const href = base + encodeURIComponent(it.name) + (it.isDirectory() ? '/' : '');
      return '<li><a href="' + href + '">' + esc(it.name) + (it.isDirectory() ? '/' : '') + '</a></li>';
    })
    .join('\n');
  return (
    '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><title>' + esc(urlPath) + '</title>' +
    '<style>body{font:14px/1.7 system-ui,"PingFang SC","Segoe UI",sans-serif;margin:24px;color:#171717}' +
    'h1{font-size:16px}ul{padding-left:20px;line-height:2}a{color:#02743B;text-decoration:none}' +
    'a:hover{text-decoration:underline}</style>' +
    '<h1>目录：' + esc(urlPath) + '</h1><ul>\n' + rows + '\n</ul></html>'
  );
}

// 启动前先确认根目录存在，避免"起来了但全是 404"的困惑
try {
  const s = await stat(ROOT);
  if (!s.isDirectory()) throw new Error('不是文件夹');
} catch {
  console.error('目录不存在或不可用：' + ROOT);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath.replace(/^\/+/, '');
    let file = normalize(join(ROOT, rel));
    // 防目录穿越：只服务根目录以内的内容
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      res.writeHead(403);
      res.end('403');
      return;
    }

    let target = file;
    let st = null;
    try { st = await stat(target); } catch {}

    if (st && st.isDirectory() && file !== ROOT) {
      // 子目录：直接给目录列表
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await listing(file, urlPath));
      return;
    }
    if (!st || st.isDirectory()) {
      // 根路径（或目录）：优先返回默认首页，其次根目录列表
      let home = null;
      for (const name of HOME_FILES) {
        const cand = join(ROOT, name);
        try { const s2 = await stat(cand); if (s2.isFile()) { home = cand; break; } } catch {}
      }
      if (home) {
        target = home;
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(await listing(ROOT, '/'));
        return;
      }
    }

    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store' // 避免内置浏览器吃到旧缓存，改完刷新即见新版
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404：文件不存在');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用（可能预览服务已在运行）。换端口再试：node engineering/预览服务.mjs ' + (PORT + 1));
  } else {
    console.error('启动失败：' + err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('预览服务已启动（Ctrl+C 停止）：');
  console.log('  根目录：' + ROOT);
  console.log('  http://localhost:' + PORT + '/');
  console.log('提示：在 Trae 里按住 Ctrl 点击上面的链接，即可用内置浏览器打开查看。');
});