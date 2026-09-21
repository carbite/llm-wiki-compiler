/**
 * llmwiki viewer — Simplified Chinese display layer.
 *
 * The compiler's routes, profile ids, file names, commands, API values and
 * authored page content remain unchanged. This module translates only the
 * viewer-owned chrome and explanatory copy after it enters the DOM. A mutation
 * observer covers route renders and async panels without coupling localization
 * to every renderer. Protected selectors keep user-authored and diagnostic
 * values verbatim.
 */

const COPY = new Map(Object.entries({
  "Skip to main content": "跳到主要内容",
  "Search wiki": "搜索知识库",
  "Search…": "搜索…",
  Theme: "主题",
  "Scientific Clay": "科学黏土",
  "Minimal (system)": "简洁（跟随系统）",
  "Nebula Light": "星云浅色",
  "Nebula Dark": "星云深色",
  "Loading your knowledge base…": "正在加载知识库…",
  Dashboard: "首页",
  BROWSE: "浏览",
  EXPLORE: "探索",
  MAINTAIN: "维护",
  CATEGORIES: "分类",
  PROJECT: "项目",
  "LOCAL · READ ONLY": "本地 · 只读",
  "compile once · reuse forever": "编译一次 · 持续复用",
  Concepts: "概念",
  Queries: "已保存的问题",
  Sources: "资料来源",
  "Source files": "源文件",
  "Graph explorer": "关系图谱",
  "Health & lint": "健康检查",
  Reviews: "待审核内容",
  "Review queue": "审核队列",
  Workflows: "工作流",
  "Lifecycle status": "生命周期状态",
  "Read the docs": "阅读文档",
  "Profiles, lint rules, export formats.": "配置模板、检查规则和导出格式。",
  "NEEDS ATTENTION": "需要处理",
  "ALL CLEAR": "状态正常",
  "FRESHNESS UNVERIFIED": "新鲜度未验证",
  "LINT NEVER RUN": "尚未运行检查",
  "Your knowledge base is ready.": "你的知识库已经准备好了。",
  "Browse compiled index →": "查看编译后的索引 →",
  "Explore graph": "查看关系图谱",
  "Recently compiled": "最近编译",
  "Recently updated": "最近更新",
  "View all": "查看全部",
  "Nothing compiled yet": "还没有编译内容",
  "Compiled pages appear here newest first, each with its citation count and freshness.": "编译后的页面会按时间从新到旧显示，并列出引用数量和新鲜度。",
  "Nothing authored yet": "还没有编写内容",
  "cited pages, most recent first": "有引用的页面，最近更新的排在前面",
  "Knowledge graph": "知识关系图谱",
  Fit: "适应窗口",
  "hover a node to inspect": "将鼠标移到节点上查看详情",
  concept: "概念",
  entity: "实体",
  stale: "已过期",
  dangling: "悬空目标",
  relation: "关系",
  "size = degree": "大小 = 连接数",
  "Compile receipt": "编译信息",
  Root: "根目录",
  Profile: "配置",
  State: "状态",
  Index: "索引",
  Lint: "内容检查",
  available: "可用",
  "not compiled": "尚未编译",
  "never run": "尚未运行",
  "Citations resolved": "已解析引用",
  "Next actions": "下一步操作",
  "Run lint": "运行内容检查",
  "Export for agents": "导出给智能体使用",
  "The LLM Wiki pattern": "LLM Wiki 的工作方式",
  "01 · COMPILE ONCE": "01 · 编译一次",
  "02 · TRACEABLE": "02 · 可以追溯",
  "03 · AGENT & HUMAN": "03 · 人和智能体共用",
  "04 · PROFILES": "04 · 配置模板",
  "Dismiss this panel": "关闭此说明",
  All: "全部",
  Stale: "已过期",
  Orphaned: "失去来源",
  Contradicted: "存在矛盾",
  Archived: "已归档",
  "Saved queries": "已保存的问题",
  "Raw sources": "原始资料",
  "No sources yet": "还没有资料来源",
  "No pages match this filter": "没有符合筛选条件的页面",
  "No concepts yet": "还没有概念页面",
  "No saved queries yet": "还没有保存的问题",
  "Filter by freshness": "按新鲜度筛选",
  citations: "引用数量",
  today: "今天",
  "No matches.": "没有找到匹配内容。",
  Health: "健康检查",
  CONTENTS: "内容统计",
  "counts only — nothing here is a problem": "这里仅显示数量，不代表存在问题",
  Citations: "引用",
  "Awaiting review": "等待审核",
  "queue clear": "队列为空",
  "none yet": "暂无",
  Freshness: "内容新鲜度",
  UNVERIFIED: "未验证",
  "IN SYNC": "已同步",
  Traceability: "可追溯性",
  "No concept pages yet.": "还没有概念页面。",
  "No citations recorded yet.": "还没有记录引用。",
  "Every citation resolves to a real source span.": "每条引用都能追溯到真实的原文片段。",
  "No cached lint summary yet — run `llmwiki lint`.": "还没有内容检查结果，请运行 `llmwiki lint`。",
  RULE: "规则",
  "MOST AFFECTED": "受影响最多",
  COUNT: "数量",
  FIX: "查看",
  "view →": "查看 →",
  Kind: "类型",
  Confidence: "置信度",
  "Information origin": "信息来源状态",
  "Contradicted by": "矛盾内容",
  Tags: "标签",
  Aliases: "别名",
  Created: "创建时间",
  Updated: "更新时间",
  Warnings: "警告",
  STALE: "已过期",
  ORPHANED: "失去来源",
  CONTRADICTED: "存在矛盾",
  ARCHIVED: "已归档",
  "Technical details": "技术详情",
  "Nothing to graph yet": "还没有可展示的关系图谱",
  "Click to open page": "点击打开页面",
  "Edge kind": "连接类型",
  "Node kind": "节点类型",
  "Node size": "节点大小",
  "larger = more connections": "越大表示连接越多",
  "Arranging graph…": "正在整理关系图谱…",
  "Nothing awaiting review": "没有等待审核的内容",
  "No summary recorded.": "没有记录摘要。",
  "No sources recorded": "没有记录资料来源",
  "Low confidence": "置信度较低",
  "Contradicts its sources": "与资料来源矛盾",
  "Missing or invalid information": "信息缺失或无效",
  "Citation problem": "引用存在问题",
  "Review requested": "已请求审核",
  "Imported from a wiki bundle": "从 Wiki 数据包导入",
  "Imported from an external service": "从外部服务导入",
  "No rendered content.": "没有可显示的内容。",
  "About this record": "记录信息",
  Yes: "是",
  No: "否",
  "not verified in this view": "未在当前页面中验证",
}));

const PROTECTED_SELECTOR = [
  ".rendered-body", ".page-title", ".list-title", ".recent-title",
  ".result-title", ".result-snippet", ".tip-title", ".entity-field-value",
  ".source-preview", ".workflow-problem", ".profile-problem-message",
  ".warning-banner", "pre", "code", "dd",
].join(",");

const UI_SELECTOR = ".skip-link, .sidebar, .app-header, .main-pane, .support-rail";

function dynamicCopy(value) {
  const rules = [
    [/^(\d+)d$/, "$1 天前"],
    [/^(\d+) min$/, "$1 分钟"],
    [/^(\d+) h$/, "$1 小时"],
    [/^(\d+) pages?, (\d+) citations? traced to source spans\.$/, "$1 个页面，$2 条引用可追溯到原文。"],
    [/^(\d+) compiled · (\d+) on disk$/, "$1 个已编译 · 磁盘上共 $2 个"],
    [/^All (\d+) concepts? →$/, "全部 $1 个概念 →"],
    [/^All (\d+) types? →$/, "全部 $1 个类型 →"],
    [/^(\d+) nodes? · (\d+) edges?$/, "$1 个节点 · $2 条连接"],
    [/^(\d+) dangling targets?$/, "$1 个悬空目标"],
    [/^(\d+) of (\d+) citations resolve to a source file$/, "$2 条引用中有 $1 条可追溯到源文件"],
    [/^(\d+) PROBLEMS?$/, "$1 个问题"],
    [/^(\d+) errors?$/, "$1 个错误"],
    [/^(\d+) warnings?$/, "$1 个警告"],
    [/^Freshness as of (.+)$/, "新鲜度检查时间：$1"],
    [/^Search failed: (.+)$/, "搜索失败：$1"],
    [/^Page not found: (.+)$/, "找不到页面：$1"],
    [/^Could not load graph: (.+)$/, "无法加载关系图谱：$1"],
    [/^Question: (.+)$/, "问题：$1"],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}

function localized(value) {
  return COPY.get(value) ?? dynamicCopy(value);
}

function canTranslate(textNode) {
  const parent = textNode.parentElement;
  return Boolean(parent?.closest(UI_SELECTOR)) && !parent.closest(PROTECTED_SELECTOR);
}

// The JSDOM test evaluates this asset from source, so static coverage cannot
// see the exercised early returns in test/viewer-zh.test.ts.
// fallow-ignore-next-line complexity
function translateTextNode(textNode) {
  if (!canTranslate(textNode)) return;
  const raw = textNode.nodeValue ?? "";
  const value = raw.trim();
  if (!value) return;
  const translated = localized(value);
  if (translated === value) return;
  textNode.nodeValue = raw.replace(value, translated);
}

// Same source-evaluation coverage blind spot as translateTextNode above.
// fallow-ignore-next-line complexity
function translateAttributes(root) {
  const nodes = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll("*")] : [];
  for (const node of nodes) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, localized(value));
    }
  }
}

function translateSubtree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
    translateTextNode(textNode);
  }
}

function startChineseDisplay() {
  document.documentElement.lang = "zh-CN";
  document.title = "llmwiki 知识库";
  translateSubtree(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateTextNode(record.target);
      for (const node of record.addedNodes) translateSubtree(node);
    }
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
}

/** Enable Chinese for a Chinese browser, or when the URL explicitly requests it. */
function wantsChineseDisplay() {
  const requested = new URLSearchParams(location.search).get("lang");
  if (requested === "zh-CN") return true;
  return navigator.language.toLowerCase().startsWith("zh");
}

if (wantsChineseDisplay()) startChineseDisplay();
