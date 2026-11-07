/** Graph interactions against a fictional, isolated component fixture. No Herdr/API traffic. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build as viteBuild } from "vite";
import { chromePath } from "./chrome-path.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-graph-")));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  const repo = join(import.meta.dir, ".."), output = join(root, "dist");
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(repo, "scripts/graph-fixture.tsx"), join(root, "fixture.tsx"));
  writeFileSync(join(root, "index.html"), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
  await viteBuild({ configFile: join(repo, "vite.config.ts"), root, publicDir: false, logLevel: "warn", build: { outDir: output, emptyOutDir: true } });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname.startsWith("/api")) throw new Error("Graph fixture must not discover sources");
    return new Response(Bun.file(join(output, url.pathname === "/" ? "index.html" : url.pathname.slice(1))));
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const width of [1280, 390]) for (const theme of ["dark", "light"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, isMobile: width === 390, colorScheme: theme, locale: "en-US", reducedMotion: "reduce" });
    try {
      await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })), theme);
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.port}`);
      const node = page.locator('[data-graph-node="session"]');
      await node.waitFor();
      await node.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
      await page.waitForFunction(() => document.querySelector('[data-graph-node="session"]')?.getAttribute("aria-pressed") === "true");
      assert.equal(await page.locator('[data-graph-node="done"]').count(), 0);
      await node.focus(); await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Prune branches", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      assert.equal(await page.getByLabel("Opened target").innerText(), "session");
      const transform = await node.getAttribute("transform");
      await page.getByRole("button", { name: "Live update", exact: true }).click();
      assert.equal(await node.getAttribute("transform"), transform, "logical position survives status, machine and order changes");
      await page.getByRole("button", { name: "Switch view", exact: true }).click();
      await page.getByRole("button", { name: "Switch view", exact: true }).click();
      await node.waitFor();
      assert.equal(await node.getAttribute("aria-pressed"), "true", "selection survives view switch");
      assert.equal(await node.getAttribute("transform"), transform);
      await page.getByLabel("Search graph", { exact: true }).fill("compost");
      await page.locator('[data-graph-node="offline"]').waitFor();
      assert.equal(await node.count(), 0);
      const offline = page.locator('[data-graph-node="offline"]');
      await offline.focus(); await page.keyboard.press("Space");
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true);
      const location = page.url();
      await page.reload();
      await page.getByRole("heading", { name: "Compost", exact: true }).waitFor();
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "compost");
      assert.equal(page.url(), location, "shareable graph location survives reload");
      await page.getByLabel("Search graph", { exact: true }).fill("");
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const sessionBox = await node.boundingBox(); assert.ok(sessionBox);
      if (width === 390) {
        await page.touchscreen.tap(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
        assert.equal(await node.getAttribute("aria-pressed"), "true", "phone tap selects the intended node");
      } else {
        const beforeDrag = await node.getAttribute("transform");
        await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2); await page.mouse.down();
        await page.mouse.move(sessionBox.x + sessionBox.width / 2 + 35, sessionBox.y + sessionBox.height / 2 + 25, { steps: 5 }); await page.mouse.up();
        assert.notEqual(await node.getAttribute("transform"), beforeDrag, "node drag changes its retained layout position");
      }
      await page.getByLabel("Show completed", { exact: true }).check();
      await page.locator('[data-graph-node="done"]').waitFor();
      const surface = page.getByRole("group", { name: "Interactive graph", exact: true });
      const before = await surface.locator(":scope > g").getAttribute("transform");
      await surface.focus(); await page.keyboard.press("ArrowRight");
      assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), before, "keyboard pans");
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const box = await surface.boundingBox(); assert.ok(box);
      if (width === 1280) {
        const transformBeforeDrag = await surface.locator(":scope > g").getAttribute("transform");
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x + 70, box.y + 60, { steps: 5 }); await page.mouse.up();
        assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), transformBeforeDrag, "pointer background drag pans");
        const transformBeforeWheel = await surface.locator(":scope > g").getAttribute("transform");
        await page.mouse.wheel(0, -120);
        await page.waitForFunction((before) => document.querySelector(".graph-surface > g")?.getAttribute("transform") !== before, transformBeforeWheel);
      }
      if (width === 390) {
        const cdp = await context.newCDPSession(page);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        const scaleBefore = Number((await surface.locator(":scope > g").getAttribute("transform"))!.match(/scale\(([^)]+)\)/)![1]);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: x - 30, y }, { id: 2, x: x + 30, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: x - 60, y }, { id: 2, x: x + 60, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
        const scaleAfter = Number((await surface.locator(":scope > g").getAttribute("transform"))!.match(/scale\(([^)]+)\)/)![1]);
        assert.ok(Math.abs(scaleAfter / scaleBefore - 2) < 0.05, `pinch follows finger distance (${scaleAfter / scaleBefore})`);
        const afterPinch = await surface.locator(":scope > g").getAttribute("transform");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 3, x: box.x + 20, y: box.y + 20 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 3, x: box.x + 55, y: box.y + 45 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), afterPinch, "a fresh drag works after pinch cancellation");
        await cdp.detach();
      }
      const ungrouped = await page.locator('[data-graph-node="offline"]').getAttribute("transform");
      await page.getByLabel("Group by machine", { exact: true }).check();
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const grouped = await page.locator('[data-graph-node="offline"]').getAttribute("transform");
      assert.notEqual(grouped, ungrouped, "machine grouping has an explicit alternative layout");

      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow");
      if (process.env.UI_EVIDENCE_DIR) {
        const evidence = join(process.env.UI_EVIDENCE_DIR, "graph"); mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, `${width}-${theme}.png`), animations: "disabled" });
      }
      const missingFocus = new URL(page.url()); missingFocus.searchParams.set("gf", "gone");
      await page.goto(missingFocus.href);
      await page.getByText("This graph focus is unavailable.", { exact: true }).last().waitFor();
      await page.getByLabel("Focus graph", { exact: true }).selectOption("");
      await page.locator('[data-graph-node="session"]').waitFor();
      await page.evaluate(() => localStorage.setItem("ovis:graph:v1", '{"version":99,"future":"keep"}'));
      await page.reload();
      await page.getByLabel("Search graph", { exact: true }).fill("future reader");
      assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v1")), '{"version":99,"future":"keep"}', "future storage is never overwritten");
      await page.evaluate(() => localStorage.setItem("ovis:graph:v1", '{"version":'));
      await page.reload();
      await page.getByLabel("Search graph", { exact: true }).fill("malformed reader");
      assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v1")), '{"version":', "unparseable storage bytes are preserved while controls remain usable");
      assert.deepEqual(errors, []);
      console.log(`PASS Graph ${width}px ${theme}: selection, filters, stale target, update, view switch, deep link, keyboard viewport`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); server?.stop(); rmSync(root, { recursive: true, force: true });
}
