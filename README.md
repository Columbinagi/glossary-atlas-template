# 词条图鉴模板（glossary-atlas-template）

**词条图鉴模板 = 单文件、零外部请求的图鉴引擎 + 内容 / 工程双线骨架。**

本仓库就是「词条图鉴模板」：本地文件夹用中文名 `词条图鉴模板`，GitHub 仓库名用英文 `glossary-atlas-template`，两者是同一份东西。

---

## 这是什么 / 不是什么

**是什么**

- 一套可复制的骨架：clone 下来，照下面「怎么用它派生」改 4 处接线，就能开始做一个新主题的图鉴。
- 一条已经跑通的工作流：内容线只写 Markdown（`content/`），工程线只碰脚本（`engineering/`），两边靠 `CONTRACT.md` 的数据契约衔接，互不越界。
- 一个单文件站点引擎：`templates/词条图鉴模板-v5.html`（约 353 KiB），样式、脚本、字体全部内联，**零外部请求**——没有 CDN、没有字体外链、没有统计代码，断网双击也能打开。

**不是什么**

- **不是成品站点，也不含任何内容数据。** `content/知识库/`、`content/知识库-en/`、`content/词条清单.md`、`content/更新日志.md` 在模板里都不存在（这是刻意的：模板不带源项目的内容）。所以 clone 下来直接跑构建会报错——**这不是坏掉，是骨架的预期状态**，先把内容放进去即可。也正因如此，本仓库不附任何截图或演示站点。
- **不是 npm 项目。** 没有 `package.json`，零第三方依赖，脚本只用 Node 内置模块，不需要 `npm install`。
- **不是通用前端框架。** 它只做「术语图鉴」这一种形态：卡片流 + 详情 + 搜索（含拼音首字母与容错）+ 闪卡自测 + 更新日志 + 收藏，中英双语界面。

## 快速开始

前置：Node.js（本机实测 v24.16.0）。零依赖、零安装。

```bash
git clone https://github.com/NahidaTribbie/glossary-atlas-template.git
cd glossary-atlas-template
```

下面 6 步是**照抄模板后第一次跑通的最短路径**。每一步都是实测必要的，缺哪步会红都已注明。

**① 建产物目录**

```bash
mkdir dist          # Windows PowerShell: New-Item -ItemType Directory dist
```

`engineering/拼合.mjs` 不会自建 `dist/`，缺了会直接 `ENOENT` 崩掉。

**② 改 `content/站点配置.js`**

这里决定全站结构：`SITE_META`（品牌名、标题、搜索框文案、页脚）、`TOPICS`（主题）、`CATEGORIES`（主题内分类）、`DEFAULT_TOPIC`（打开时显示哪个主题）。

**③ 写第一张卡片**

一个术语 = 一张卡片 = 一个 md 文件，放在 `content/知识库/<主题名>/<编号>-<id>.md`。例 `content/知识库/我的主题甲/005-example-term.md`：

```markdown
## 5. 示例词条

- id: `example-term`
- 主题: `t1`

### 是什么

- 一句话说清这条术语是什么。
```

`## N.` 里的 N 就是学习主线顺序（列表排序、详情页左右切换、「接下来学什么」都按它走），文件名前缀必须与它一致。完整字段表见 `content/内容规范.md` §3——除 `id` / `name` / `definition` 外全部可选，留空则对应模块不渲染。

**④ 建 `content/词条清单.md`**

它是内容线的唯一选题依据，也是 `校验.mjs` 的**硬闸门**：文件不存在就必定报错。表格数据行格式：

```markdown
| 005 | example-term | 示例词条 | t1 | 我的主题甲 | 已上线 |
```

即 `| 编号 | id | 中文名 | 主题id | 范围 | 状态 |`。状态为「已上线」的行必须有对应卡片，卡片也必须能在清单里找到；「待写」的行不参与这两项检查。

**⑤ 建 `content/更新日志.md`，并至少写 1 条**

```markdown
## 2026-10-05

### v0.1.0 起步

- 建立骨架并收录第一条词条
收录：example-term
```

成因说明：文件**缺失**时 `拼合.mjs` 会写入 `CHANGELOG = null`，站点自检直接报错「CHANGELOG 必须是数组」；文件**为空**时降级成警告「CHANGELOG 为空」，而 `校验.mjs` 要求精确的「0 错误 · 0 警告」，所以**空文件仍不通过**。`收录：` 里引用的 id 必须已存在。

**⑥ 构建与自检**

```bash
node engineering/拼合.mjs      # 合入 content/ → 产出 dist/<产物名>.html
node engineering/校验.mjs      # 交付前自检，要求「0 错误 · 0 警告」
node engineering/预览服务.mjs   # 本地预览，默认 http://localhost:8123/
```

首跑后**固定还会剩两条红**：`校验.mjs` 里的「搜索语料回归」探针写死了源主题的词（`'永磁'` / `'ycdj'` 配 `#topic=t5`），不换成你自己的首条词条必然报红。见「接线点」第 2 条。

## 目录结构

```
词条图鉴模板/
├── CONTRACT.md                  内容线与工程线的数据契约、边界与字段冻结说明 —— 派生时读一遍，一般不改
├── content/                     【内容线】日常唯一要写的地方
│   ├── 站点配置.js              品牌名 / 主题 / 分类 / 主题色 —— 派生时必改（接线点 1、4）
│   ├── 内容规范.md              给内容创作者的手册：字段表、写作纪律、编号规则 —— 派生时改标题与示例（接线点 4）
│   ├── 知识库/                  （模板中不存在）一卡一文件的词条卡片 —— 派生时新建，天天写
│   ├── 知识库-en/               （模板中不存在）英文卡片，按 id 与中文卡配对，可选 —— 派生时按需新建
│   ├── 词条清单.md              （模板中不存在）唯一选题依据、校验硬闸门 —— 派生时新建
│   ├── 更新日志.md              （模板中不存在）Keep a Changelog 风格 —— 派生时新建并写 1 条
│   └── 草稿/                    （模板中不存在）不被拼合读取的草稿区 —— 派生时按需新建
├── engineering/                 【工程线】构建与自检脚本，只依赖 Node 内置模块
│   ├── 拼合.mjs                 把 content/ 合入母版，产出单文件站点 —— 接线点 1
│   ├── 校验.mjs                 交付前自检：解析 / 往返无损 / 清单 / 更新日志 / 语法 / 资产 / 拼音 / #debug —— 接线点 1、2
│   ├── lib-md.mjs               Markdown 知识库解析器与序列化器，拼合与校验共用 —— 一般不动
│   ├── 收录草稿.mjs             把 content/草稿/ 里的卡片收录进知识库
│   ├── 重排编号.mjs             编号压实工具（--step=N），保序但改动面大，日常不用
│   └── 预览服务.mjs             本地静态服务器，默认端口 8123 —— 接线点 1
├── skills/                      AI 协作技能，给 AI 助手读的操作规程
│   ├── term-card-draft/SKILL.md    生成一张新卡片草稿
│   └── term-card-publish/SKILL.md  审阅通过后收录上线 —— 接线点 4
├── templates/
│   └── 词条图鉴模板-v5.html     单文件引擎母版（含 PYI 拼音表与演示「积木」）—— 接线点 3
├── .gitattributes               文本文件一律 LF，避免 Windows CRLF 假差异
└── .gitignore                   忽略 dist/ 等由 content/ 可重新生成的产物
```

## 怎么用它派生

把模板复制/克隆成一个新项目后，**必改的就这 5 处**。前 3 处不改，第一跑不会全绿。

**1. 产物文件名写死在 3 个脚本里** —— `engineering/拼合.mjs:17`、`engineering/校验.mjs:17`、`engineering/预览服务.mjs:33`，三处硬编码了同一个产物路径 `dist/<源项目品牌名>.html`，其中品牌名与 `content/站点配置.js` 的 `SITE_META.brandName`（模板里现成的那份）同值。

建议改成由 `content/站点配置.js` 的 `SITE_META.brandName` 推导，以后换主题只改站点配置一处：

```js
// 拼合.mjs / 校验.mjs —— 直接读站点配置里的品牌名（该文件是普通 `var` 脚本，不能 import 取导出）
const cfgText = fs.readFileSync(path.join(CONTENT_DIR, '站点配置.js'), 'utf8');
const BRAND = cfgText.match(/brandName:\s*'([^']+)'/)[1];
const OUT = path.join(ROOT, 'dist', BRAND + '.html');
```

```js
// 预览服务.mjs:33（该脚本是纯静态服务器，读不了配置，需手动同步成同一文件名）
const HOME_FILES = ['index.html', 'dist/<你的品牌名>.html'];
```

**2. `校验.mjs` 的「搜索语料回归」探针写死** —— `engineering/校验.mjs:301` 的 `const probes = ['永磁', 'ycdj'];`，配合第 303–304 行的 `#topic=t5`，断言「中文界面能搜到 ≥1 卡，英文界面命中数不少于中文」。换成你的主题后这两条必红（实测：新主题 0 卡）。

改法二选一：把 `probes` 换成你首条词条的名字与它的拼音首字母串，并把 `#topic=t5` 换成它所属主题；或改成从数据推导（取 `DEFAULT_TOPIC` 的第一条词条的 `name` 与 `name` 的 PYI 首字母串）。

**3. 引擎里的 PYI 拼音表只覆盖现有内容的用字** —— `templates/词条图鉴模板-v5.html:2670` 的 `var PYI = {...}`（对应源内容实际用到的 1472 个汉字 → 拼音首字母）。

新主题会缺字。`校验.mjs:240-257` 会点名缺哪些字（形如 `id·名称「某」`），按提示把「汉字 → 拼音首字母」补进母版这张表后重拼合即可。PYI 只影响拼音搜索，缺字不会让站点崩。

**4. 品牌名与产物名散落在 8 个文件、共 13 行里** —— 全局搜索模板里现成的品牌名 / 产物名，逐个替换成你新项目的名字。下面是逐行核对过的完整清单：

| 位置 | 是什么 |
|---|---|
| `content/站点配置.js:11` | `SITE_META.brandName`（源项目品牌名现值） |
| `content/站点配置.js:12` | `SITE_META.brandShort`（源项目英文缩写现值） |
| `content/站点配置.js:13` | 上一行的注释：英文缩写的含义说明 |
| `content/站点配置.js:15` | `SITE_META.pageTitle` |
| `content/站点配置.js:24` | `SITE_META.footerNote` |
| `content/内容规范.md:16` | 表格里提到的「拼合产物文件名」一行 |
| `content/内容规范.md:66` | 写作纪律第 5 条里点名的行业（面向哪个行业的学习者），换主题必改 |
| `CONTRACT.md:34` | 「输出 = `dist/<产物名>`」一行 |
| `engineering/拼合.mjs:17` | 产物输出路径（同接线点 1） |
| `engineering/校验.mjs:17` | 产物输出路径（同接线点 1） |
| `engineering/预览服务.mjs:33` | 首页候选文件名（同接线点 1） |
| `skills/term-card-publish/SKILL.md:54` | 「不要改 `engineering/` 下的脚本或 `<产物名>`」 |
| `templates/词条图鉴模板-v5.html:48` | 母版头部注释里的产物文件名 |

要清的还有 `SITE_META.brand` / `brandTagline` / `searchPlaceholder`，以及 `content/站点配置.js` 里 `TOPICS`（源项目的十个主题）、`DEFAULT_TOPIC`、`CATEGORIES` 三块——它们是源项目的知识地图，通常整块换成你自己的。

**5. 内容规范与技能的正文** —— `content/内容规范.md`（写作纪律、编号规则、英文翻译时机）与 `skills/` 下两个 SKILL.md 都是按源项目的实际情况写的。结构和纪律可以直接沿用，但里面举例用的术语、主题名、编号段（如「当前主线」那一段）要按你的项目重写。

**另外建议记一笔**：在自己的 README 或 `CONTRACT.md` 里写一行「派生自 glossary-atlas-template v1.0.0（commit <短哈希>）」。模板以后修了，才追得回差异。

## 模板里还带着哪些源项目痕迹（已于 v1.0.0 逐条核对）

上面 5 处是**必改**的。除此之外，14 个骨架文件是**逐字节取自源项目提交 `af88476`** 的（这是刻意的：与运行中的项目保持一致才可复现、可审计），因此里面还留有一批源项目的**历史注脚**。它们不影响运行——都是注释、文档措辞或对可选文件的引用——但外人读到会困惑，所以在此逐条列明，免得你以为仓库缺文件：

| 痕迹 | 位置 | 说明与影响 |
|---|---|---|
| `MEMORY §23 / §31-3 / §31-4 / §32-8` | `engineering/收录草稿.mjs:106`、`engineering/校验.mjs:208,233,288`、母版 HTML 4 处 | 指向源项目的内部经验记录（`MEMORY.md` 属进度文档，**不在本仓库**）。纯注释注脚，无功能影响 |
| `.workbuddy/memory/2026-09-27.md` | `engineering/校验.mjs:233` | 同上：源项目的工具目录，不在本仓库 |
| `AGENTS.md` / `.trae/` / `.workbuddy/` / `release/` | `.gitignore:1-10` | 忽略规则是按源项目结构写的，这四者在本模板里都不存在。无害；派生后可精简成自己项目的结构 |
| `任务书①` 等内部编号 | `content/站点配置.js:16,20`、母版 HTML 16 处 | 源项目的任务编号，注释性质的溯源信息 |
| `content/术语对照表.md` | `content/内容规范.md:117` | 源项目的译名基准表（属内容数据，不在模板里）。要做英文版时需自建 |
| `content/词条清单.md` | `content/内容规范.md:71-72`、`CONTRACT.md:14`、`校验.mjs` 与 `重排编号.mjs` 多处 | 同上，但这是**必建**的（见快速开始 ④） |
| `content/更新日志-en.md` | `CONTRACT.md:35`、`拼合.mjs` 与 `校验.mjs` 多处 | 可选的英文更新日志，缺则自动回退中文 |
| `content/知识库` / `知识库-en` / `草稿/` | 各脚本 | 目录不存在时按设计降级或提示（`知识库` 为权威源，空则拼合报错，见快速开始 ③） |

## 环境要求

- **Node.js**：唯一硬依赖。脚本只用 Node 内置模块，无需 `npm install`，也无 `package.json`。
- **无头 Chrome（可选）**：`engineering/校验.mjs:18` 写死了 Chrome 路径 `C:/Program Files/Google/Chrome/Application/chrome.exe`，用来自检站点内置的 `#debug` 报告与搜索语料回归。没有它（或装在别处）时，这几项会降级打印「⏸ 需外部验证」并单独计数，**不计入失败**，并给出需要你手动执行的 chrome 命令；校验仍以退出码 0 通过。要自动化就把这行改成你机器上的真实路径。
- 浏览器：任意现代浏览器。站点是单文件，双击 `dist/<产物名>.html` 即可打开。

## 来源与版本

- **本模板自一个已在运行的图鉴项目抽出，源提交 `af88476`（当时工作区干净），未含该项目任何内容数据、进度文档与产物。** 14 个骨架文件与源提交逐字节一致（SHA256 全等），全部 LF 换行。
- 版本：**v1.0.0** —— 骨架 14 个文件 + `README.md` + `LICENSE`，共 16 个文件的完整快照（tag `v1.0.0`）。
- 派生新项目时请记下「派生自哪一版」；模板升级后，这条记录是唯一能对齐差异的线索。

## 许可证

[MIT](LICENSE) © 2026 NahidaTribbie
