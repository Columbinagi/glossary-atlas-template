/* ============================================================
   engineering/起步.mjs —— 一条命令把「模板骨架」变成「能跑的新项目」
   用法：node engineering/起步.mjs

   它做四件事（可重复运行：已存在的一律跳过，不覆盖你写的东西）：
     ① 建 dist/ —— 拼合.mjs 不会自建产物目录，缺了直接 ENOENT
     ② 写一张示例卡片 content/知识库/示例/005-永磁电机.md（主题 t5）
     ③ 建 content/词条清单.md —— 校验.mjs 的硬闸门，缺文件必红
     ④ 建 content/更新日志.md —— 拼合缺它会写 CHANGELOG = null，#debug 直接报错
   随后自动执行 拼合 + 校验，并提示接下来该改什么。

   为什么示例卡片叫「永磁电机」：校验.mjs 内置的搜索语料探针写死了
   ['永磁','ycdj'] 与 #topic=t5，而「永磁电机」的拼音首字母串正好是 ycdj，
   字面又含「永磁」——所以样板阶段无需改动任何代码即可全绿。等你换成自己的
   内容时，请照 docs/派生与排错.md「接线点 2」把探针改成你的首条词条。

   红线：本脚本只新增 content/ 下的内容文件，不改 engineering/ 与 templates/。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = (...p) => path.join(ROOT, ...p);
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };
let made = 0, kept = 0;
const step = (n, label, p, body) => {
  if (fs.existsSync(p)){ console.log(n + ' ' + label + '：已存在，跳过'); kept++; }
  else { write(p, body); console.log(n + ' ' + label + '：已创建'); made++; }
};

/* ① dist/（直接建目录，不塞占位文件） */
const DIST = C('dist');
if (fs.existsSync(DIST)){ console.log('① dist/：已存在，跳过'); kept++; }
else { fs.mkdirSync(DIST, { recursive: true }); console.log('① dist/：已创建'); made++; }

/* ② 示例卡片：名字取「永磁电机」，正好落在 校验.mjs 的写死探针上 */
const card = [
  '## 5. 永磁电机', '',
  '- id: `yongci-motor`',
  '- 主题: `t5`', '',
  '### 是什么', '',
  '- 这是起步脚本写下的示例卡片，用来先把「写卡片 → 拼合 → 校验」这条链跑通一次。',
  '- 换成你自己的内容时：改这张卡的名字与 id，同步改 content/词条清单.md，并按 docs/派生与排错.md 接线点 2 改掉 engineering/校验.mjs 里的搜索探针。',
  ''
].join('\n');
step('②', '示例卡片 content/知识库/示例/005-永磁电机.md', C('content', '知识库', '示例', '005-永磁电机.md'), card);

/* ③ 词条清单.md：内容线的唯一选题依据，校验的硬闸门 */
const manifest = [
  '# 词条清单', '',
  '内容线的唯一选题依据：清单里有的才写，想写清单外的先加行。校验会核对编号、中文名与状态是否两边一致。', '',
  '| 编号 | id | 中文名 | 主题 | 范围 | 状态 |',
  '|---|---|---|---|---|---|',
  '| 005 | yongci-motor | 永磁电机 | t5 | 示例 | 已上线 |', ''
].join('\n');
step('③', 'content/词条清单.md', C('content', '词条清单.md'), manifest);

/* ④ 更新日志.md：缺文件时拼合会写 CHANGELOG = null，站点自检直接报错 */
const d = new Date();
const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const changelog = [
  '## ' + day, '',
  '### v0.1.0 项目起步', '',
  '- 由 engineering/起步.mjs 建立骨架并跑通第一条链路',
  '收录：yongci-motor', ''
].join('\n');
step('④', 'content/更新日志.md', C('content', '更新日志.md'), changelog);

console.log('\n—— 新建 ' + made + ' 项，跳过 ' + kept + ' 项 ——\n');

/* 自动跑拼合 + 校验（子进程输出直接透传，看到的就是真实报告） */
for (const s of ['拼合.mjs', '校验.mjs']){
  console.log('▶ node engineering/' + s);
  const r = spawnSync(process.execPath, [C('engineering', s)], { stdio: 'inherit' });
  if (r.status !== 0){
    console.log('\n✗ ' + s + ' 退出码 ' + r.status + '。若只红「搜索语料（永磁 / ycdj）」两条，那是探针写死所致，照 docs/派生与排错.md 接线点 2 换成你自己的首条词条即可。');
    process.exit(r.status || 1);
  }
}
console.log('\n✓ 起步完成：站点已产出到 dist/，校验通过。接下来把 content/站点配置.js 的品牌名与主题改成你自己的，并替换掉那张示例卡片。');
