/**
 * Chinese display-layer coverage for static chrome, route updates, and the
 * boundary that keeps authored knowledge content unchanged.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const SCRIPT = readFileSync("src/viewer/assets/viewer-zh.js", "utf8");

function mount(body: string): JSDOM {
  const dom = new JSDOM(`<title>llmwiki viewer</title><body>${body}</body>`, {
    runScripts: "outside-only",
    url: "http://viewer.test/?lang=zh-CN",
  });
  dom.window.eval(SCRIPT);
  return dom;
}

describe("Simplified Chinese viewer display", () => {
  it("translates viewer chrome and document metadata", () => {
    const dom = mount('<nav class="sidebar">Dashboard</nav><main class="main-pane">Loading your knowledge base…</main>');
    expect(dom.window.document.documentElement.lang).toBe("zh-CN");
    expect(dom.window.document.title).toBe("llmwiki 知识库");
    expect(dom.window.document.body.textContent).toContain("首页");
    expect(dom.window.document.body.textContent).toContain("正在加载知识库…");
    dom.window.close();
  });

  it("translates later route renders without changing authored content", async () => {
    const dom = mount('<main class="main-pane"></main>');
    const main = dom.window.document.querySelector("main")!;
    main.innerHTML = '<h1>Health</h1><div class="rendered-body"><p>Sources</p></div>';
    await Promise.resolve();
    expect(main.querySelector("h1")?.textContent).toBe("健康检查");
    expect(main.querySelector(".rendered-body")?.textContent).toBe("Sources");
    dom.window.close();
  });
});
