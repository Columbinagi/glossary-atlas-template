/* ============================================================
   content/站点配置.js —— 数据区上半：SITE_META / TOPICS / DEFAULT_TOPIC / CATEGORIES
   本文件属于【内容线】：主题、分类、品牌与页脚文案在这里改。
   合入：node engineering/拼合.mjs    校验：node engineering/校验.mjs（改完必跑）
   来源：2026-09-19 自 v4 引擎交付物数据区无损抽出
   ============================================================ */
/* ↓↓↓↓↓↓ 数据区原文（勿在本标记外添加内容）↓↓↓↓↓↓ */
/* ================== 模块配置区：接入时必改 ================== */
var SITE_META = {
  brand: '鉴',                             // 品牌字（v5 2026-09-27 起 logo 已图形化为闪电，此字段仅作标题兜底保留）
  brandName: '新能源汽车知识图鉴',          // 顶栏品牌名（悬停 logo 区时展开显示的全称）
  brandShort: 'NEV',                       // 顶栏品牌简称（logo 旁常驻；悬停展开全称。NEV = New Energy Vehicle，
                                           // 新能源汽车英文缩写，行业通用。缺省回落 brandName）
  brandTagline: '看图懂术语',              // 品牌名下副标题（悬停展开态的第二行）
  pageTitle: '新能源汽车知识图鉴',          // 列表 / 搜索 / 收藏视图的标签页标题
  changelogTitle: '更新日志 · {brand}',     // 更新日志视图的标签页标题（任务书①，2026-09-26）
  navLinks: [                              // 顶栏导航（单文件站默认一项；可清空 []）
    {label: '词条', current: true},
    {label: '自测', href: '#practice'},    // 闪卡自测视图入口（2026-09-27 体验批次）
    {label: '更新', href: '#changelog'}    // 更新日志视图入口（任务书①，2026-09-26）
  ],
  searchPlaceholder: '搜索词条，试试「电驱」「永磁」「多合一」…',
  searchLabel: '搜索词条',
  footerNote: '新能源汽车知识图鉴 · 个人学习整理 · 数据类表述均标注时间锚点与来源',
  /* v4：标题模板。可用 {name} {nameEn} {topic} {q} {brand}，改这里即全站生效 */
  titleTemplate: '{name} · {brand}',       // 词条详情
  notFoundTitle: '这一条走丢了 · {brand}',  // 无效词条
  searchTitle: '搜索「{q}」· {brand}',      // 搜索结果
  /* v4：主题色。themeDefault 须是 THEME_COLORS 里的键；
     themeColors 提供则整表覆盖内置八色（结构见引擎区 THEME_COLORS） */
  themeDefault: 'klein',
  themeColors: null
};

/* 主题（侧栏 chips，三级体系第一级；首页默认展示 DEFAULT_TOPIC）
   设计：侧栏必须一眼看全「这个图鉴有几大块」——所以九个主题一次性全部列出来，
   未开工的主题下各挂一条「主题导言」词条，说明这块讲什么、现在什么状态，不留 0 词条的空白页。
   t0「图鉴总览」是与九个主题并列的一个主题，说明图鉴的组织方式与覆盖情况——它不是打开后的第一屏。
   顺序按知识地图的三层结构排：认知层 → 技术核心 → 体验与落地。
   nameEn / headingEn 可选：英文界面下侧栏 chips 与主题大标题取它们（缺则回退中文）。 */
var TOPICS = [
  {id: 't0', name: '图鉴总览', nameEn: 'Overview', heading: '图鉴总览 · 这份图鉴怎么组织', headingEn: 'Overview · How this glossary is organized'},
  {id: 't1', name: '整车与平台', nameEn: 'Vehicle & Platform', heading: '整车与平台 术语图鉴', headingEn: 'Vehicle & Platform Glossary'},
  {id: 't2', name: '三电系统总览', nameEn: 'Three-Electric Overview', heading: '三电系统总览 术语图鉴', headingEn: 'Three-Electric Overview Glossary'},
  {id: 't3', name: '市场与产业链', nameEn: 'Market & Supply Chain', heading: '市场与产业链 术语图鉴', headingEn: 'Market & Supply Chain Glossary'},
  {id: 't4', name: '动力电池', nameEn: 'Traction Battery', heading: '动力电池 术语图鉴', headingEn: 'Traction Battery Glossary'},
  {id: 't5', name: '电驱与电机', nameEn: 'E-Drive & Motors', heading: '电驱与电机 术语图鉴', headingEn: 'E-Drive & Motors Glossary'},
  {id: 't6', name: '电控与电气架构', nameEn: 'E/E Architecture', heading: '电控与电气架构 术语图鉴', headingEn: 'E/E Architecture Glossary'},
  {id: 't7', name: '补能与热管理', nameEn: 'Charging & Thermal', heading: '补能与热管理 术语图鉴', headingEn: 'Charging & Thermal Glossary'},
  {id: 't8', name: '智能化与底盘', nameEn: 'ADAS & Chassis', heading: '智能化与底盘 术语图鉴', headingEn: 'ADAS & Chassis Glossary'},
  {id: 't9', name: '岗位与能力地图', nameEn: 'Career & Skills Map', heading: '岗位与能力地图 术语图鉴', headingEn: 'Career & Skills Map Glossary'}
];
var DEFAULT_TOPIC = 't5';   // 打开即显示「电驱与电机」——术语卡片流；总览只作为可点进的主题

/* 细分类（主题内分节）
   t5「电驱与电机」：c1–c4（已全部启用）。
   t1「整车与平台」：c5–c9 全部启用（c5–c7 随第一批；c8「整车参数与开发」随第二批；
   c9「车身与安全」随第三批收官）。
   t2「三电系统总览」：c10–c13 随 2026-10-02 一批启用（本主题收官）。
   t3「市场与产业链」：c14–c16 随 2026-10-02 一批启用（本主题收官）。
   t4「动力电池」：c17–c20 随 2026-10-02 一批启用（本主题收官）。
   t6「电控与电气架构」：c21–c24 随 2026-10-02 一批启用（本主题收官）。
   t7「补能与热管理」：c25–c28 随 2026-10-03 一批启用（本主题收官）。
   新分类一律随词条上线再登记，不留空锚点 */
var CATEGORIES = [
  {id: 'c1', topic: 't5', name: '电驱系统总体', nameEn: 'E-Drive Systems'},
  {id: 'c2', topic: 't5', name: '驱动电机本体', nameEn: 'Motor Hardware'},
  {id: 'c3', topic: 't5', name: '控制器与功率器件', nameEn: 'Power Electronics'},
  {id: 'c4', topic: 't5', name: '传动与评价体系', nameEn: 'Final Drive & Metrics'},
  {id: 'c5', topic: 't1', name: '整车构成', nameEn: 'Vehicle Composition'},
  {id: 'c6', topic: 't1', name: '平台与架构', nameEn: 'Platform & Architecture'},
  {id: 'c7', topic: 't1', name: '车型分类与分级', nameEn: 'Models & Segments'},
  {id: 'c8', topic: 't1', name: '整车参数与开发', nameEn: 'Vehicle Metrics & Development'},
  {id: 'c9', topic: 't1', name: '车身与安全', nameEn: 'Body & Safety'},
  {id: 'c10', topic: 't2', name: '能量与电压', nameEn: 'Energy & Voltage'},
  {id: 'c11', topic: 't2', name: '控制与分工', nameEn: 'Control & Roles'},
  {id: 'c12', topic: 't2', name: '形式与配置', nameEn: 'Forms & Configs'},
  {id: 'c13', topic: 't2', name: '温度与安全', nameEn: 'Thermal & Safety'},
  {id: 'c14', topic: 't3', name: '产业链与分工', nameEn: 'Supply Chain & Roles'},
  {id: 'c15', topic: 't3', name: '市场与格局', nameEn: 'Market & Landscape'},
  {id: 'c16', topic: 't3', name: '政策与经营', nameEn: 'Policy & Business'},
  {id: 'c17', topic: 't4', name: '电芯与化学体系', nameEn: 'Cell & Chemistry'},
  {id: 'c18', topic: 't4', name: '成组与结构', nameEn: 'Pack & Structure'},
  {id: 'c19', topic: 't4', name: '管理与安全', nameEn: 'BMS & Safety'},
  {id: 'c20', topic: 't4', name: '电压与整车接口', nameEn: 'Voltage & Interface'},
  {id: 'c21', topic: 't6', name: '架构与线束', nameEn: 'Architecture & Harness'},
  {id: 'c22', topic: 't6', name: '车载网络', nameEn: 'In-Vehicle Networks'},
  {id: 'c23', topic: 't6', name: '控制与配电', nameEn: 'Control & Power Distribution'},
  {id: 'c24', topic: 't6', name: '安全与诊断', nameEn: 'Safety & Diagnostics'},
  {id: 'c25', topic: 't7', name: '充电体系', nameEn: 'Charging Systems'},
  {id: 'c26', topic: 't7', name: '补能方式与车网互动', nameEn: 'Refueling & V2G'},
  {id: 'c27', topic: 't7', name: '热管理回路', nameEn: 'Thermal Management Loop'},
  {id: 'c28', topic: 't7', name: '低温与热安全', nameEn: 'Cold Weather & Thermal Safety'}
];

/* ↑↑↑↑↑↑ 数据区原文结束 ↑↑↑↑↑↑ */
