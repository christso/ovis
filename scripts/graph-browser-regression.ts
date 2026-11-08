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
    if (url.pathname === "/storage.html") return new Response("<!doctype html><title>Fixture state setup</title>", { headers: { "content-type": "text/html" } });
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
      assert.ok(await page.locator(".graph-node-label").evaluateAll((labels) => labels.length > 0 && labels.every((label) => { const matrix = (label as SVGTextElement).getScreenCTM()!; return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b) >= 11.99; })), "visible labels keep a readable screen size at every viewport scale");
      const reset = page.getByRole("button", { name: "Reset graph layout", exact: true });
      assert.equal(await reset.innerText(), "Reset", "layout reset has a visible text label");
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
      const graphSurface = page.getByRole("group", { name: "Interactive graph", exact: true });
      const layoutBeforeSelection = await graphSurface.evaluate((svg) => ({ viewport: svg.querySelector(":scope > g")?.getAttribute("transform"), nodes: [...svg.querySelectorAll("[data-graph-node]")].map((item) => [item.getAttribute("data-graph-node"), item.getAttribute("transform")]) }));
      await node.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
      await page.waitForFunction(() => document.querySelector('[data-graph-node="session"]')?.getAttribute("aria-pressed") === "true");
      stage = "selection neighbourhood";
      const opacity = (id: string) => page.locator(`[data-graph-node="${id}"]`).evaluate((element) => Number(getComputedStyle(element).opacity));
      assert.equal(await opacity("session"), 1, "selected node remains visible");
      assert.equal(await opacity("execution"), 1, "direct neighbour remains visible");
      assert.ok(await opacity("checkout") < 0.5, "selection dims a second-degree node instead of highlighting the whole component");
      assert.ok(await opacity("offline") < 0.5, "selection dims unrelated nodes");
      assert.equal(await page.locator('.graph-edge').filter({ hasText: "Recorded session: prune" }).evaluate((element) => Number(getComputedStyle(element).opacity)), 1, "selected node's incident link remains visible");
      assert.ok(await page.locator('.graph-edge').filter({ hasText: "Recorded repository: orchard" }).evaluate((element) => Number(getComputedStyle(element).opacity)) < 0.5, "unrelated links are dimmed");
      assert.deepEqual(await graphSurface.evaluate((svg) => ({ viewport: svg.querySelector(":scope > g")?.getAttribute("transform"), nodes: [...svg.querySelectorAll("[data-graph-node]")].map((item) => [item.getAttribute("data-graph-node"), item.getAttribute("transform")]) })), layoutBeforeSelection, "highlighting keeps nodes and viewport in place");
      if (!mobile) {
        await page.locator('[data-graph-node="checkout"]').hover();
        assert.equal(await opacity("repo"), 1, "mouse hover previews direct neighbours");
        assert.ok(await opacity("session") < 0.5, "hover does not expand through indirect relationships");
        assert.equal(await node.getAttribute("aria-pressed"), "true", "hover does not replace persistent selection");
        await node.focus(); await page.keyboard.press("Enter");
        assert.equal(await opacity("execution"), 1, "keyboard activation takes precedence over a stationary mouse preview");
        assert.ok(await opacity("checkout") < 0.5);
        await page.getByLabel("Search graph", { exact: true }).hover();
        assert.equal(await opacity("execution"), 1, "leaving the hovered node restores selection highlighting");
        assert.ok(await opacity("repo") < 0.5);
      }
      await node.focus(); await page.keyboard.press("Escape");
      assert.equal(await node.getAttribute("aria-pressed"), "false", "Escape from a node clears selection");
      assert.equal(await opacity("offline"), 1, "clearing selection restores the full graph");
      await node.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
      const blank = await graphSurface.evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        for (const [x, y] of [[box.x + 10, box.y + 10], [box.right - 10, box.y + 10]]) {
          const target = document.elementFromPoint(x!, y!);
          if (target?.closest("svg.graph-surface") === svg && !target.closest("[data-graph-node]")) return { x: x!, y: y! };
        }
        return null;
      });
      assert.ok(blank, "fixture has a visible empty canvas target");
      if (mobile) await page.touchscreen.tap(blank.x, blank.y); else await page.mouse.click(blank.x, blank.y);
      assert.equal(await node.getAttribute("aria-pressed"), "false", "empty canvas tap clears selection");
      assert.equal(await opacity("offline"), 1);
      await node.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
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
      assert.equal(await page.locator('[data-graph-node="offline"]').evaluate((element) => Number(getComputedStyle(element).opacity)), 1, "filtered-out selection never dims every visible node");
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
      const sessionBox = await node.locator(".graph-node-disc").boundingBox(); assert.ok(sessionBox);
      if (mobile) {
        stage = "pinch cancel";
        await page.touchscreen.tap(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
        assert.equal(await node.getAttribute("aria-pressed"), "true", "phone tap selects the intended node");
      } else {
        const beforeDrag = await node.getAttribute("transform");
        await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2); await page.mouse.down();
        await page.mouse.move(sessionBox.x + sessionBox.width / 2 + 35, sessionBox.y + sessionBox.height / 2 + 25, { steps: 5 }); await page.mouse.up();
        assert.notEqual(await node.getAttribute("transform"), beforeDrag, "node drag changes its retained layout position");
        assert.equal(await page.locator('[data-graph-node="offline"]').getAttribute("aria-pressed"), "true", "dragging another node preserves the current selection");
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
        assert.equal(await page.locator('[data-graph-node="offline"]').getAttribute("aria-pressed"), "true", "background pan does not clear selection");
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
      stage = "reset layout";
      await options(true); await page.getByLabel("Show completed", { exact: true }).check(); await page.getByLabel("Group by machine", { exact: true }).check(); await options(false);
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      const resetDefaults = await page.locator("[data-graph-node]").evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute("data-graph-node"), node.getAttribute("transform")])));
      await node.focus(); await page.keyboard.press("Enter");
      const beforeReset = await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!));
      const dragBox = (await node.locator(".graph-node-disc").boundingBox())!;
      const start = { x: dragBox.x + dragBox.width / 2, y: dragBox.y + dragBox.height / 2 };
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 30, y: start.y + 20 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 30, start.y + 20, { steps: 5 }); await page.mouse.up();
      }
      assert.notEqual(await node.getAttribute("transform"), resetDefaults.session, "dragged node moves before reset");
      await surface.focus(); await page.keyboard.press("ArrowRight");
      const draggedFrame = await surface.locator(":scope > g").getAttribute("transform");
      await reset.click();
      await page.waitForFunction((defaults) => [...document.querySelectorAll("[data-graph-node]")].every((node) => node.getAttribute("transform") === defaults[node.getAttribute("data-graph-node")!]), resetDefaults);
      await page.waitForFunction((frame) => document.querySelector(".graph-surface > g")?.getAttribute("transform") !== frame, draggedFrame);
      assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), draggedFrame, "reset refits the graph");
      const afterReset = await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!));
      assert.equal(afterReset.selected, beforeReset.selected, "reset preserves selection");
      assert.deepEqual(afterReset.filters, beforeReset.filters, "reset preserves filters");
      assert.equal(afterReset.groupMachine, true, "reset preserves grouping");
      await page.reload(); await node.waitFor();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!).positions), afterReset.positions, "reset positions survive reload");
      assert.equal(await node.getAttribute("transform"), resetDefaults.session);
      if (mobile) {
        assert.ok((await reset.boundingBox())!.height >= 44, "reset meets phone touch size");
        assert.ok(await page.locator(".graph-tools").evaluate((tools) => { const box = tools.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth; }), "labeled toolbar fits a narrow phone");
        await node.focus(); await page.keyboard.press("Enter");
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
        assert.equal(await node.getAttribute("aria-pressed"), "true", "pinch cancellation does not clear selection");
        const afterPinch = await surface.locator(":scope > g").getAttribute("transform");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 3, x: box.x + 20, y: box.y + 20 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 3, x: box.x + 55, y: box.y + 45 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), afterPinch, "a fresh drag works after pinch cancellation");
        await cdp.detach();
      }
      await page.goto(`http://127.0.0.1:${server.port}/storage.html`);
      await page.evaluate(() => localStorage.setItem("ovis:graph:v1", JSON.stringify({ version: 1, selected: "session", filters: { search: "prune", status: "", machine: "", focus: "", showCompleted: false, communication: "recent" }, groupMachine: false, positions: { session: { x: 9999, y: 9999 } }, viewport: { x: 1, y: 2, k: 1 } })));
      await page.goto(`http://127.0.0.1:${server.port}`); await node.waitFor();
      assert.equal(await node.getAttribute("aria-pressed"), "true", "column-layout migration preserves selected identity");
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "prune", "column-layout migration preserves filters");
      const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!));
      assert.equal(migrated.layout, "force");
      assert.notDeepEqual(migrated.positions.session, { x: 9999, y: 9999 }, "the retired column positions receive a natural layout once");
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
  // Exercise the animated D3 path separately from the reduced-motion accessibility matrix.
  const motion = await browser.newContext({ viewport: { width: 1280, height: 844 }, reducedMotion: "no-preference", locale: "en-US" });
  try {
    const page = await motion.newPage(); page.setDefaultTimeout(15000);
    await page.goto(`http://127.0.0.1:${server.port}`);
    const node = page.locator('[data-graph-node="session"]'), neighbour = page.locator('[data-graph-node="execution"]');
    await node.waitFor();
    const colour = (id: string) => page.locator(`[data-graph-node="${id}"] .graph-node-disc`).evaluate((disc) => getComputedStyle(disc).fill);
    assert.equal(await colour("repo"), await colour("checkout"));
    assert.equal(await colour("checkout"), await colour("execution"));
    assert.notEqual(await colour("repo"), await colour("harbour"));
    assert.ok(Number(await page.locator('[data-graph-node="checkout"]').getAttribute("data-radius")) > Number(await page.locator('[data-graph-node="repo"]').getAttribute("data-radius")));
    const box = (await node.locator(".graph-node-disc").boundingBox())!;
    const before = await neighbour.getAttribute("transform");
    const storedBefore = await page.evaluate(() => localStorage.getItem("ovis:graph:v1"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 60, { steps: 8 });
    await page.waitForFunction((before) => document.querySelector('[data-graph-node="execution"]')?.getAttribute("transform") !== before, before);
    assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v1")), storedBefore, "animated ticks do not persist unfinished coordinates");
    const held = await node.getAttribute("transform");
    await page.getByRole("button", { name: "Add neighbour", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await page.locator('[data-graph-node="new-neighbour"]').waitFor();
    const coordinates = (value: string) => value.match(/[-\d.]+/g)!.map(Number);
    const [oldX, oldY] = coordinates(held!), [newX, newY] = coordinates((await node.getAttribute("transform"))!);
    assert.ok(Math.hypot(newX! - oldX!, newY! - oldY!) < 45, "a topology update starts from visible dragged coordinates instead of the older saved frame");
    const heldAfterTopology = await page.evaluate(async (expected) => {
      const node = document.querySelector('[data-graph-node="session"]')!, neighbour = document.querySelector('[data-graph-node="new-neighbour"]')!;
      const before = neighbour.getAttribute("transform"); let frames = 0, drift = false;
      await new Promise<void>((resolve) => { const frame = () => { frames++; drift ||= node.getAttribute("transform") !== expected; if (frames >= 24) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
      return { drift, neighbourMoved: neighbour.getAttribute("transform") !== before };
    }, held!);
    assert.equal(heldAfterTopology.drift, false, "a held drag remains pinned under the cursor through topology replacement and subsequent simulation frames");
    assert.equal(heldAfterTopology.neighbourMoved, true, "the new force simulation actually advances while preserving the dragged pin");
    await page.mouse.up();
    const released = await page.evaluate(() => { const point = JSON.parse(localStorage.getItem("ovis:graph:v1")!).positions.session; return `translate(${point.x} ${point.y})`; });
    await page.getByRole("button", { name: "Switch view", exact: true }).click();
    await page.getByRole("button", { name: "Switch view", exact: true }).click(); await node.waitFor();
    assert.equal(await node.getAttribute("transform"), released, "a normal-motion drag checkpoints at release so an immediate view departure preserves the released layout");
    // The remount intentionally stops at its saved checkpoint; resume a real gesture to prove cooling.
    const resumed = (await node.locator(".graph-node-disc").boundingBox())!;
    await page.mouse.move(resumed.x + resumed.width / 2, resumed.y + resumed.height / 2); await page.mouse.down();
    await page.mouse.move(resumed.x + resumed.width / 2 + 40, resumed.y + resumed.height / 2 + 20, { steps: 4 }); await page.mouse.up();
    const settled = async () => page.evaluate(async () => {
      const began = performance.now(); let stableFrames = 0, last = "";
      await new Promise<void>((resolve, reject) => {
        const frame = () => {
          const saved = JSON.parse(localStorage.getItem("ovis:graph:v1") ?? "null"), nodes = [...document.querySelectorAll("[data-graph-node]")];
          const signature = nodes.map((node) => node.getAttribute("transform")).join("|");
          const matches = saved && nodes.every((node) => { const point = saved.positions[node.getAttribute("data-graph-node")!]; return point && node.getAttribute("transform") === `translate(${point.x} ${point.y})`; });
          stableFrames = matches && signature === last ? stableFrames + 1 : 0; last = signature;
          if (stableFrames >= 12) resolve();
          else if (performance.now() - began > 15000) reject(new Error("Animated graph did not settle to its persisted frame"));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    });
    await settled();
    const stable = await page.evaluate(async () => {
      const svg = document.querySelector(".graph-surface")!, nodes = [...svg.querySelectorAll("[data-graph-node]")], frame = svg.querySelector(":scope > g")!.getAttribute("transform");
      const positions = nodes.map((node) => node.getAttribute("transform"));
      [...document.querySelectorAll('nav button')].find((button) => button.textContent === 'Live update')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      let frames = 0, changed = false;
      await new Promise<void>((resolve) => { const check = () => { frames++; changed ||= document.querySelector(".graph-surface") !== svg || nodes.some((node, index) => !node.isConnected || node.getAttribute("transform") !== positions[index]) || svg.querySelector(":scope > g")!.getAttribute("transform") !== frame; if (frames >= 80) resolve(); else requestAnimationFrame(check); }; requestAnimationFrame(check); });
      return { changed, frames };
    });
    assert.equal(stable.changed, false, "settled status/order polling never reheats, remounts, jitters or refits the graph");
    await page.getByRole("button", { name: "Reset graph layout", exact: true }).click(); await settled();
    const savedReset = await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!));
    await page.reload(); await node.waitFor();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("ovis:graph:v1")!).positions), savedReset.positions, "settled reset survives reload without a simulation restart");
    console.log("PASS animated graph: repository colours, distinct-neighbour radius, connected drag, topology continuity, settled polling, deferred persistence, reset/reload");
  } finally { await motion.close(); }

  const dense = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", locale: "en-US" });
  try {
    const page = await dense.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}?dense=1`);
    await page.waitForFunction(() => document.querySelectorAll("[data-graph-node]").length === 150);
    const labels = await page.locator(".graph-node-label").evaluateAll((labels) => labels.map((label) => { const box = label.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
    assert.ok(labels.length >= 5, "dense overview retains meaningful readable labels");
    for (const [index, a] of labels.entries()) for (const b of labels.slice(index + 1)) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, "shown dense overview labels do not overlap");
    assert.equal(await page.locator(".graph-repository-legend span").count(), 5);
    if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "graph-dense-390-overview.png") });
    const surface = page.locator(".graph-surface");
    const beforePan = await surface.locator(":scope > g").getAttribute("transform");
    await surface.focus(); await page.keyboard.press("ArrowRight");
    assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), beforePan);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    await page.getByRole("button", { name: /^Graph filters/ }).click();
    await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption("dense-agent-0-0");
    await page.getByRole("button", { name: /^Graph filters/ }).click();
    const node = page.locator('[data-graph-node="dense-agent-0-0"]');
    assert.equal(await node.getAttribute("aria-pressed"), "true");
    const beforeDrag = await node.getAttribute("transform"), box = (await node.locator(".graph-node-disc").boundingBox())!;
    const cdp = await dense.newCDPSession(page), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 40, y: y + 30 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach();
    assert.notEqual(await node.getAttribute("transform"), beforeDrag, "a dense phone graph still supports node dragging");
    const snapshot = await page.locator("[data-graph-node]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-graph-node"), node.getAttribute("transform")]));
    const frame = await surface.locator(":scope > g").getAttribute("transform");
    await page.getByRole("button", { name: "Live update", exact: true }).click();
    assert.deepEqual(await page.locator("[data-graph-node]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-graph-node"), node.getAttribute("transform")]).sort()), snapshot.sort(), "dense status/order polling preserves settled positions");
    assert.equal(await surface.locator(":scope > g").getAttribute("transform"), frame);
    assert.equal(await node.getAttribute("aria-pressed"), "true");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "graph-dense-390-selected.png") });
    assert.deepEqual(errors, []);
    console.log("PASS dense 150-node / 5-repository fictional phone graph: readable non-overlapping overview labels, pan/zoom/select/touch drag, settled polling and no overflow");
  } finally { await dense.close(); }

} finally {
  await browser?.close(); server?.stop(); rmSync(root, { recursive: true, force: true });
}
