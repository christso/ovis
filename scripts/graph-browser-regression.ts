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
  for (const [width, height] of [[1280, 844], [390, 844], [320, 844], [390, 640], [320, 640]]) for (const theme of ["dark", "light"] as const) {
    const mobile = width! <= 700;
    const context = await browser.newContext({ viewport: { width: width!, height: height! }, hasTouch: mobile, isMobile: mobile, colorScheme: theme, locale: "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    let stage = "initial";
    try {
      await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })), theme);
      page.setDefaultTimeout(10_000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.port}`);
      const node = page.locator('[data-graph-node="session"]');
      await node.waitFor();
      const filters = page.getByRole("button", { name: /^Graph filters/ });
      const options = async (open: boolean) => {
        if (mobile && await filters.getAttribute("aria-expanded") !== String(open)) await filters.click();
      };
      const screenshot = async (name: string) => {
        if (!process.env.UI_EVIDENCE_DIR) return;
        const evidence = join(process.env.UI_EVIDENCE_DIR, "graph-mobile"); mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, `${width}-${height}-${theme}-${name}.png`), animations: "disabled" });
      };
      if (mobile) {
        await filters.waitFor();
        assert.equal(await filters.getAttribute("aria-expanded"), "false", "phone filters start collapsed");
        assert.equal(await page.getByRole("combobox", { name: "Status", exact: true }).count(), 0);
        assert.ok((await node.boundingBox())!.height >= 44, "fresh phone nodes start at readable/tappable scale");
        assert.ok((await page.locator(".graph-stage").boundingBox())!.height >= (height === 844 ? 440 : 300), "collapsed controls leave materially more phone canvas");
        const initialViewport = await page.locator(".graph-surface > g").getAttribute("transform");
        await screenshot("fresh");
        await filters.tap();
        await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("working");
        await page.getByRole("combobox", { name: "Machine", exact: true }).selectOption("north");
        await options(false);
        assert.match(await filters.innerText(), /2/);
        assert.equal(await page.locator(".graph-surface > g").getAttribute("transform"), initialViewport, "filter disclosure and values never refit the viewport");
        await page.reload(); await node.waitFor();
        assert.equal(await filters.getAttribute("aria-expanded"), "false");
        assert.match(await filters.innerText(), /2/, "collapsed filters reveal persisted active values");
        assert.equal(await page.locator(".graph-surface > g").getAttribute("transform"), initialViewport, "saved phone viewport wins on reload");
        await filters.focus(); await page.keyboard.press("Enter");
        assert.equal(await filters.getAttribute("aria-expanded"), "true", "keyboard opens advanced controls");
        assert.ok(await page.locator(".graph-controls").evaluate((element) => element.scrollHeight <= element.clientHeight), "advanced controls have no clipped scrollbox");
        await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("");
        await page.getByRole("combobox", { name: "Machine", exact: true }).selectOption("");
        await options(false);
      }
      await node.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
      await page.waitForFunction(() => document.querySelector('[data-graph-node="session"]')?.getAttribute("aria-pressed") === "true");
      assert.equal(await page.locator('[data-graph-node="done"]').count(), 0);
      await node.focus(); await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: "Prune branches", exact: true }).waitFor();
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      assert.equal(await page.getByLabel("Opened target").innerText(), "session");
      if (mobile) {
        stage = "details tap before pinch";
        const details = page.getByRole("button", { name: "Details and help", exact: true });
        await details.tap();
        await page.waitForFunction(() => document.querySelector('[aria-label="Details and help"]')?.getAttribute("aria-expanded") === "true");
        await details.tap();
        await page.waitForFunction(() => document.querySelector('[aria-label="Details and help"]')?.getAttribute("aria-expanded") === "false");
      }
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
      stage = "overview tap";
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      await node.scrollIntoViewIfNeeded();
      const sessionBox = await node.boundingBox(); assert.ok(sessionBox);
      if (mobile) {
        stage = "pinch cancel";
        await page.touchscreen.tap(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
        assert.equal(await node.getAttribute("aria-pressed"), "true", "phone tap selects the intended node");
      } else {
        const beforeDrag = await node.getAttribute("transform");
        await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2); await page.mouse.down();
        await page.mouse.move(sessionBox.x + sessionBox.width / 2 + 35, sessionBox.y + sessionBox.height / 2 + 25, { steps: 5 }); await page.mouse.up();
        assert.notEqual(await node.getAttribute("transform"), beforeDrag, "node drag changes its retained layout position");
      }
      await options(true); await page.getByLabel("Show completed", { exact: true }).check(); await options(false);
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
      const ungrouped = await page.locator('[data-graph-node="offline"]').getAttribute("transform");
      await options(true); await page.getByLabel("Group by machine", { exact: true }).check(); await options(false);
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const grouped = await page.locator('[data-graph-node="offline"]').getAttribute("transform");
      assert.notEqual(grouped, ungrouped, "machine grouping has an explicit alternative layout");

      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow");
      await page.getByRole("button", { name: "Long labels", exact: true }).click();
      stage = "long inspector";
      await options(true); await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption("session"); await options(false);
      if (mobile) {
        const details = page.getByRole("button", { name: "Details and help", exact: true });
        assert.equal(await details.getAttribute("aria-expanded"), "false");
        await page.getByRole("button", { name: "Open in Workspace", exact: true }).scrollIntoViewIfNeeded();
        for (const control of [filters, details, page.getByRole("button", { name: "Open in Workspace", exact: true }), page.getByRole("button", { name: "Fit graph", exact: true })]) assert.ok((await control.boundingBox())!.height >= 44, "phone actions meet touch size");
        await screenshot("selected");
        await details.tap();
        stage = "expanded inspector";
        await page.waitForFunction(() => document.querySelector('[aria-label="Details and help"]')?.getAttribute("aria-expanded") === "true");
        await screenshot("details-open");
        await page.getByText("/fictional/very-long-project-directory/seasonal-orchard-accessibility-review/working-checkout-with-an-unusually-long-name", { exact: true }).scrollIntoViewIfNeeded();
        await page.getByRole("button", { name: "Focus this node", exact: true }).scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "long names/paths do not widen the page");
        await screenshot("details");
        await details.click();
      } else await screenshot("desktop");
      const missingFocus = new URL(page.url()); missingFocus.searchParams.set("gf", "gone");
      stage = "missing focus";
      await page.goto(missingFocus.href);
      await page.getByText("This graph focus is unavailable.", { exact: true }).last().waitFor();
      await options(true);
      await page.getByLabel("Focus graph", { exact: true }).selectOption("");
      await page.locator('[data-graph-node="session"]').waitFor();
      await page.evaluate(() => localStorage.removeItem("ovis:graph:v1"));
      stage = "empty inventory reload";
      await page.goto(`http://127.0.0.1:${server.port}?empty=1`);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("ovis:graph:v1") ?? "null")?.version === 1);
      await page.reload();
      await page.getByRole("button", { name: "Load inventory", exact: true }).click();
      await node.waitFor();
      const loaded = new URL(page.url()); loaded.searchParams.delete("empty");
      await page.evaluate((url) => history.replaceState(history.state, "", url), loaded.href);
      await page.waitForFunction(() => document.querySelector(".graph-surface > g")?.getAttribute("transform") !== "translate(160 100) scale(1)");
      assert.ok((await node.boundingBox())!.x < width!, "an empty persisted default frame is framed when inventory arrives");
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!));
      stage = "custom saved viewport";
      await page.evaluate((saved) => localStorage.setItem("ovis:graph:v1", JSON.stringify({ ...saved, positions: {}, viewport: { x: 61, y: 83, k: 0.63 } })), saved);
      await page.reload(); await node.waitFor();
      assert.equal(await page.locator(".graph-surface > g").getAttribute("transform"), "translate(61 83) scale(0.63)", "even a saved viewport without positions is not silently reset");
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const overview = await surface.locator(":scope > g").getAttribute("transform");
      await surface.focus(); await page.keyboard.press("+"); await page.keyboard.press("0");
      assert.equal(await surface.locator(":scope > g").getAttribute("transform"), overview, "0 preserves the original Fit graph overview");
      assert.ok(await surface.evaluate((svg) => {
        const stage = svg.getBoundingClientRect();
        return [...svg.querySelectorAll("[data-graph-node]")].every((node) => { const box = node.getBoundingClientRect(); return box.x >= stage.x && box.right <= stage.right && box.y >= stage.y && box.bottom <= stage.bottom; });
      }), "Fit graph keeps every filtered node accessible in the overview");
      if (mobile) {
        await surface.scrollIntoViewIfNeeded();
        const box = (await surface.boundingBox())!;
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
      await page.evaluate(() => localStorage.setItem("ovis:graph:v1", '{"version":99,"future":"keep"}'));
      await page.reload();
      await page.getByLabel("Search graph", { exact: true }).fill("future reader");
      assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v1")), '{"version":99,"future":"keep"}', "future storage is never overwritten");
      await page.evaluate(() => localStorage.setItem("ovis:graph:v1", '{"version":'));
      await page.reload();
      await page.getByLabel("Search graph", { exact: true }).fill("malformed reader");
      assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v1")), '{"version":', "unparseable storage bytes are preserved while controls remain usable");
      assert.deepEqual(errors, []);
      console.log(`PASS Graph ${width}x${height} ${theme}: compact disclosures, readable fresh view, saved viewport, long labels, selection, filters, stale target, update, view switch, deep link, keyboard/touch viewport`);
    } catch (error) {
      console.error("Graph fixture failed", width, height, theme, stage, page.url(), errors);
      if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, `graph-failed-${width}-${height}-${theme}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); server?.stop(); rmSync(root, { recursive: true, force: true });
}
