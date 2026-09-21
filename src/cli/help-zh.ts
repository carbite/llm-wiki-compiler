/**
 * Chinese help for the top-level CLI and its direct commands.
 * Translates presentation only: command names, flags, defaults, action handlers,
 * and generated wiki language remain unchanged. Advanced nested command help
 * keeps its original descriptions. Set LLMWIKI_HELP_LANG=en for upstream help.
 */
import { Help, type Command } from "commander";

const commands: Record<string, string> = {
  llmwiki: "知识编译器：将原始资料整理成相互关联的 Wiki 知识库",
  ingest: "将网址或本地文件导入 sources/ 资料目录",
  "ingest-session": "将 Claude、Codex 或 Cursor 的会话导出文件导入 sources/",
  view: "启动本地网页，以只读方式浏览当前 Wiki",
  compile: "将 sources/ 中的资料编译成相互关联的 Wiki 页面",
  rm: "删除一份来源资料及仅由它生成的概念页面",
  refresh: "更新过期或已变化的页面，不处理无关的新资料",
  review: "查看、批准或拒绝等待审核的生成页面",
  state: "备份或重置 .llmwiki/state.json，修复状态文件版本不兼容问题",
  recover: "回滚中断编译的日志，恢复状态，无需完整重新编译",
  rules: "提取、审核并导出供下游程序使用的 RuleCandidate 规则记录",
  query: "根据 Wiki 内容回答问题",
  watch: "监听 sources/，资料变化时自动重新编译",
  lint: "按照规则检查 Wiki 的质量问题",
  status: "查看页面和来源数量、过期与孤立页面、待处理变更、审核队列和状态健康情况",
  eval: "评估 Wiki 质量：健康情况、引用覆盖率及模型评审",
  schema: "查看或初始化 Wiki 的结构配置",
  profile: "创建或查看当前 Wiki 的领域配置",
  template: "列出、查看和安装领域配置模板",
  workflow: "运行或查看领域配置中声明的工作流（实验功能）",
  artifact: "写入或验证带类型的产物文件",
  connector: "列出或运行内置数据连接器，将外部数据导入待审核区",
  export: "将 Wiki 导出为 llms.txt、JSON、GraphML、Marp 等格式",
  import: "导入 OKF 知识包，默认进入待审核区；--trusted 可直接写入 Wiki",
  next: "只读检查当前项目，建议下一步操作",
  context: "为任务整理证据材料（只读）；有条件时使用语义检索，否则使用词法检索",
  quickstart: "一次完成资料导入和编译，并建议下一步操作",
  serve: "通过标准输入输出启动 MCP 服务，向 agent 提供 Wiki 工具与资源",
  help: "显示命令的帮助信息",
};

const options: Record<string, string> = {
  "--version": "显示版本号",
  "--help": "显示帮助信息",
  "--verbose": "显示详细进度，也可设置 LLMWIKI_VERBOSE=1",
  "--provider": "仅为本次运行选择模型服务，覆盖 LLMWIKI_PROVIDER（如 anthropic、codex-agent、trae、openai、ollama）",
  "--lang": "生成内容或回答的语言，如 zh-CN（中文）、ja（日文）；覆盖 LLMWIKI_OUTPUT_LANG",
  "--concurrency": "最多同时调用模型的次数；默认 5，也可设置 LLMWIKI_COMPILE_CONCURRENCY",
  "--instructions": "追加 UTF-8 项目指令文件（最多 64 KiB）；修改或不再传入该文件会重新生成受影响页面",
  "--review": "将生成页面写入 .llmwiki/candidates/ 等待审核，不修改 wiki/；删除来源后的孤立标记推迟至下次非审核编译",
  "--no-sources-section": "不要求生成文末的 Sources 节；修改此偏好会重新编译受影响页面。等同 LLMWIKI_SOURCES_SECTION=off；取消环境变量并省略此参数可恢复默认",
  "--stale": "查找过期或失去来源的页面并进行更新清理",
  "--save": "将回答保存为 Wiki 页面",
  "--debug": "显示检索选中的页面、文本片段及其得分",
  "--port": "网页服务端口，默认 0，由操作系统分配",
  "--host": "监听地址，默认 127.0.0.1；指定其他地址需同时传入 --allow-lan",
  "--allow-lan": "允许监听本机回环地址以外的地址；需指定 --host，默认关闭",
  "--open": "启动后在默认浏览器中打开 Wiki",
  "--no-open": "编译成功后不启动网页查看器",
  "--json": "以 JSON 格式输出结果",
  "--target": "仅导出指定格式",
  "--source": "Marp 导出包含的页面类型：concepts、queries 或 all（默认 all）",
  "--project-id": "JSON 导出的项目标识；须符合 /^[a-z0-9][a-z0-9-]{0,62}$/",
  "--out": "目录型导出格式（如 OKF）的输出目录",
  "--okf": "需要导入的 OKF 知识包目录",
  "--trusted": "直接写入 wiki/，跳过待审核区；表示你认可该知识包的内容和它声明的来源",
  "--budget": "证据材料输出的近似 token 预算（默认 8000）",
  "--format": "输出格式：json 或 markdown（默认 markdown）",
  "--depth": "关联页面扩展层数，默认 1，最大 2；0 表示不扩展",
  "--top-pages": "主要页面数量上限，默认 5，最大 20",
  "--top-chunks": "语义检索片段数量上限，默认 8，最大 50",
  "--omit-root": "将输出中的 project.root 设为 null，隐藏本地路径",
  "--no-neighbors": "不扩展关联页面，neighbors 和 gaps 输出为空数组",
  "--include-sources": "附带引用对应的原文片段；最多 20 段，每段最多 30 行",
  "--root": "项目根目录",
};

const overrides: Record<string, Record<string, string>> = {
  rm: { "--dry-run": "仅预览将删除和保留的内容，不修改文件" },
  refresh: { "--dry-run": "仅预览更新计划，不调用模型，不写文件" },
  import: { "--dry-run": "仅预览将导入和跳过的内容，不写文件" },
  quickstart: {
    "--review": "生成待审核页面，不修改 wiki/",
    "--json": "输出 quickstart 的 JSON 结果，同时启用 --no-open；参数警告仍显示在标准错误中",
  },
  context: { "--json": "输出稳定的 v1 JSON 格式，覆盖 --format" },
};

const headings: Record<string, string> = {
  "Usage:": "用法：", "Options:": "选项：", "Commands:": "命令：",
  "Arguments:": "参数：", "Global Options:": "全局选项：",
};

/** Configure display callbacks without changing command parsing or actions. */
function configureCommand(command: Command): void {
  const original = new Help();
  const translatedOptions = { ...options, ...overrides[command.name()] };
  command.configureHelp({
    ...command.configureHelp(),
    commandDescription: (cmd) => commands[cmd.name()] ?? original.commandDescription(cmd),
    subcommandDescription: (cmd) => command.parent
      ? original.subcommandDescription(cmd)
      : commands[cmd.name()] ?? original.subcommandDescription(cmd),
    optionDescription: (option) => {
      const description = translatedOptions[option.long ?? ""];
      if (!description) return original.optionDescription(option);
      const localized = Object.create(option) as typeof option;
      localized.description = description;
      return original.optionDescription(localized);
    },
    styleTitle: (title) => headings[title] ?? title,
  });
}

/** Localize the main help and direct commands; keep upstream help available. */
export function configureChineseHelp(program: Command): void {
  if (process.env.LLMWIKI_HELP_LANG === "en") return;
  configureCommand(program);
  for (const command of program.commands) configureCommand(command);
  program.addHelpText("after", "\n入门顺序：ingest 导入 → compile 编译 → query 提问。\n查看参数：llmwiki compile --help；中文内容：llmwiki compile --lang zh-CN\n说明：[options] 为可选选项，<参数> 为必填参数，[参数] 为可选参数。\n");
}
