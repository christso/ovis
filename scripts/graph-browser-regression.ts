/** Fictional component inventory only; no Herdr/API traffic. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { build as viteBuild } from "vite";
import { chromePath } from "./chrome-path.ts";
import { SUPPORTED_ENTRIES } from "../src/lib/themes.generated.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-graph-")));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
const evidence = process.env.UI_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
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
  const base = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const settle = (page: Page) => page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("ovis:graph:v4") ?? "{}").positions ?? {}).length > 0);
  for (const width of [1280, 390, 320]) for (const theme of ["dark", "light"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 700, hasTouch: width < 700, colorScheme: theme, reducedMotion: "reduce", locale: "en-US" });
    await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })), theme);
    try {
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      const node = (id: string) => page.locator(`[data-graph-node="${id}"]`);
      await node("session").waitFor(); await settle(page);
      const options = async () => { if (width < 700 && await page.getByRole("button", { name: /^Graph filters/ }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: /^Graph filters/ }).click(); };
      const inspect = async (id: string) => { await options(); await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption(id); };
      const fill = (id: string) => node(id).locator(".graph-node-disc").evaluate((disc) => getComputedStyle(disc).fill);
      assert.equal(await page.locator(".graph-node-kind-workspace, .graph-node-kind-worktree").count(), 0);
      assert.equal(await page.locator(".graph-kind-legend button").count(), 2);
      assert.equal(await fill("repo"), await fill("harbour"));
      assert.notEqual(await fill("repo"), await fill("session"));
      assert.equal(await node("repo").locator(".graph-working-halo, .graph-status-icon").count(), 0);
      assert.equal(await node("session").locator(".graph-working-arc").evaluate((arc) => getComputedStyle(arc).animationName), "none");
      assert.equal(await node("offline").locator(".graph-working-halo").count(), 0);
      const hubFill = await fill("repo");
      await inspect("repo");
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).count(), 0, "a shared hub never chooses a terminal");
      await inspect("session");
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      assert.equal(await page.getByLabel("Opened target", { exact: true }).textContent(), "session");
      assert.ok((await node("session").locator("title").textContent())?.includes("feature/irrigation"));
      await page.getByRole("button", { name: "Live update", exact: true }).click();
      assert.equal(await node("session").locator(".graph-working-halo").count(), 0);
      assert.equal(await node("session").locator(".graph-status-icon").count(), 1);
      assert.equal(await fill("repo"), hubFill, "hub colour never rolls up terminal activity");
      await page.getByRole("checkbox", { name: "Show completed", exact: true }).check();
      await page.getByRole("button", { name: "Finish terminal", exact: true }).click();
      assert.equal(await node("session").locator(".graph-status-icon").count(), 1);
      assert.ok((await node("session").getAttribute("aria-label"))?.includes("DONE"));
      await page.getByRole("button", { name: "Background wait", exact: true }).click();
      assert.ok((await node("session").getAttribute("aria-label"))?.includes("BG"));
      assert.equal(await node("session").locator(".graph-working-halo").count(), 0);
      await page.getByRole("button", { name: "Disconnect source", exact: true }).click();
      assert.equal(await fill("session"), await fill("offline"));
      assert.equal(await fill("repo"), hubFill);
      await page.getByRole("checkbox", { name: "Group by machine", exact: true }).check();
      assert.equal(await page.locator("[data-machine-cloud]").count(), 2);
      const surface = page.locator(".graph-surface");
      await surface.focus(); const beforeZoom = await surface.locator(":scope > g").getAttribute("transform");
      await page.keyboard.press("+"); assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), beforeZoom);
      await page.keyboard.press("ArrowRight"); await page.keyboard.press("0");
      const beforeLegend = await surface.locator(":scope > g").getAttribute("transform");
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("ovis:graph:v4")!);
        localStorage.setItem("ovis:graph:v4", JSON.stringify({ ...state, legendOpen: false }));
      });
      await page.reload(); await node("session").waitFor();
      assert.equal(await page.getByRole("button", { name: "Legend", exact: true }).count(), 0);
      assert.equal(await page.getByRole("group", { name: "Legend", exact: true }).isVisible(), true);
      assert.equal(await page.locator(".graph-kind-legend").isVisible(), true, "an older collapsed preference cannot hide legend items");
      const legendHeight = await page.locator(".graph-legend").evaluate((element) => element.getBoundingClientRect().height);
      const itemHeight = await page.locator(".graph-kind-legend button").first().evaluate((element) => element.getBoundingClientRect().height);
      assert.ok(legendHeight <= itemHeight + 10, "legend has no extra disclosure row at desktop or phone widths");
      assert.equal(await surface.locator(":scope > g").getAttribute("transform"), beforeLegend);
      await page.locator(".graph-kind-legend").getByRole("button", { name: "Terminal", exact: true }).click();
      assert.equal(await page.locator(".graph-node-kind-terminal").count(), 0);
      await page.reload(); assert.equal(await page.locator(".graph-node-kind-terminal").count(), 0);
      await page.locator(".graph-kind-legend").getByRole("button", { name: "Terminal", exact: true }).click();
      await node("session").waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (evidence) await page.screenshot({ path: join(evidence, `graph-shared-${width}-${theme}.png`), animations: "disabled" });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px ${theme}: neutral hubs, statuses/freshness, context, terminal actions, filtering, clouds, keyboard, persistence, reduced motion, overflow`);
    } finally { await context.close(); }
  }
  for (const width of [1280, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", locale: "en-US" });
    try {
      const page = await context.newPage(); await page.goto(`${base}/?projection&graph=1&gcomm=all`);
      await page.locator('[data-graph-node="project"]').waitFor();
      const legend = page.locator(".graph-kind-legend");
      for (let mask = 0; mask < 4; mask++) {
        for (const [index, name] of ["Repository", "Terminal"].entries()) {
          const toggle = legend.getByRole("button", { name, exact: true });
          if ((await toggle.getAttribute("aria-pressed") === "true") !== !!(mask & 1 << index)) await toggle.click();
        }
        await page.waitForFunction((mask) => document.querySelectorAll(".graph-node-kind-repository").length === (mask & 1 ? 3 : 0)
          && document.querySelectorAll(".graph-node-kind-terminal").length === (mask & 2 ? 4 : 0), mask);
        assert.equal(await page.locator(".graph-node-kind-repository").count(), mask & 1 ? 3 : 0);
        assert.equal(await page.locator(".graph-node-kind-terminal").count(), mask & 2 ? 4 : 0);
        if (mask === 1) {
          assert.equal(await page.locator(".graph-edge-communication").count(), 2, "same-repository collapsed activity never becomes a self link");
          if (width < 700) await page.getByRole("button", { name: /^Graph filters/ }).click();
          await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption("project");
          if (width < 700) await page.getByRole("button", { name: "Details and help", exact: true }).click();
          assert.equal(await page.locator(".graph-relations > li").filter({ hasText: "5 recorded events" }).count(), 1);
          assert.equal(await page.locator(".graph-relations > li").filter({ hasText: "1 recorded events" }).count(), 2);
        }
      }
      await page.getByRole("combobox", { name: "Machine", exact: true }).selectOption("south");
      assert.equal(await page.locator('[data-graph-node="project"]').count(), 1, "shared hub survives filtering to its other machine");
      assert.equal(await page.locator(".graph-node-kind-terminal").count(), 2);
      await page.getByRole("combobox", { name: "Machine", exact: true }).selectOption("");
      await page.getByRole("combobox", { name: "Focus graph", exact: true }).selectOption("main-terminal");
      await legend.getByRole("button", { name: "Terminal", exact: true }).click();
      await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption("project");
      assert.equal(await page.locator(".graph-relations > li").filter({ hasText: "2 recorded events" }).count(), 1, "focus retains only its own collapsed receipts");
      console.log(`PASS ${width}px: all four projections, shared-hub machine filter, intra-repository receipts, direction, aggregation, focus`);
    } finally { await context.close(); }
  }
  const motion = await browser.newContext({ viewport: { width: 1280, height: 844 }, reducedMotion: "no-preference", locale: "en-US" });
  try {
    const page = await motion.newPage(); await page.goto(base); await settle(page);
    const node = page.locator('[data-graph-node="session"]'), surface = page.locator(".graph-surface");
    await page.waitForFunction(() => Number(document.querySelector('[data-graph-node="session"] .graph-working-arc')?.getAnimations()[0]?.currentTime) > 200);
    for (const entry of SUPPORTED_ENTRIES) {
      await page.evaluate(({ id, mode }) => { document.documentElement.setAttribute("data-theme", mode); document.documentElement.setAttribute("data-palette", id); }, entry);
      const semantic = await node.evaluate((element) => {
        const style = getComputedStyle(element), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
        const colour = (value: string) => { ctx.fillStyle = value; return ctx.fillStyle; };
        return { actual: colour(getComputedStyle(element.querySelector(".graph-node-disc")!).fill), expected: colour(style.getPropertyValue("--status-working")) };
      });
      assert.equal(semantic.actual, semantic.expected, `sidebar token preserved in ${entry.id}/${entry.mode}`);
    }
    const before = await node.getAttribute("transform"), neighbour = page.locator('[data-graph-node="repo"]');
    const neighbourBefore = await neighbour.getAttribute("transform"), box = (await node.locator(".graph-node-disc").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 12 }); await page.mouse.up();
    assert.notEqual(await node.getAttribute("transform"), before);
    await page.waitForFunction((before) => document.querySelector('[data-graph-node="repo"]')?.getAttribute("transform") !== before, neighbourBefore);
    await page.waitForFunction(() => !document.querySelector('[data-graph-node="session"]')?.matches(":active"));
    await page.getByRole("button", { name: "Add communication", exact: true }).click();
    assert.equal(await node.getAttribute("data-degree"), "3");
    await page.getByRole("combobox", { name: "Communication links", exact: true }).selectOption("none");
    assert.equal(await node.getAttribute("data-degree"), "1");
    await page.getByRole("combobox", { name: "Communication links", exact: true }).selectOption("all");
    await page.getByRole("button", { name: "Reset graph layout", exact: true }).click();
    await page.getByRole("button", { name: "Fit graph", exact: true }).click(); await surface.focus(); await page.keyboard.press("Escape");
    {
      await page.waitForFunction(() => {
        const state = JSON.parse(localStorage.getItem("ovis:graph:v4") ?? "null");
        return state && [...document.querySelectorAll("[data-graph-node]")].every((node) => { const point = state.positions[node.getAttribute("data-graph-node")!]; return point && node.getAttribute("transform") === `translate(${point.x} ${point.y})`; });
      });
    const box = (await node.locator(".graph-node-disc").boundingBox())!;
    const before = await neighbour.getAttribute("transform");
    const storedBefore = await page.evaluate(() => localStorage.getItem("ovis:graph:v4"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 60, { steps: 8 });
    await page.waitForFunction((before) => document.querySelector('[data-graph-node="execution"]')?.getAttribute("transform") !== before, before);
    assert.equal(await page.evaluate(() => localStorage.getItem("ovis:graph:v4")), storedBefore, "animated ticks do not persist unfinished coordinates");
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
    const released = await page.evaluate(() => { const point = JSON.parse(localStorage.getItem("ovis:graph:v4")!).positions.session; return `translate(${point.x} ${point.y})`; });
    await page.getByRole("button", { name: "Switch view", exact: true }).click();
    await page.getByRole("button", { name: "Switch view", exact: true }).click(); await node.waitFor();
    assert.equal(await node.getAttribute("transform"), released, "a normal-motion drag checkpoints at release so an immediate view departure preserves the released layout");
    // The remount intentionally stops at its saved checkpoint; resume a real gesture to prove cooling.
    const resumed = (await node.locator(".graph-node-disc").boundingBox())!;
    await page.mouse.move(resumed.x + resumed.width / 2, resumed.y + resumed.height / 2); await page.mouse.down();
    await page.mouse.move(resumed.x + resumed.width / 2 + 40, resumed.y + resumed.height / 2 + 20, { steps: 4 }); await page.mouse.up();
    }
    console.log("PASS animated graph: every theme's sidebar colours, working halo, connected drag, receipt sizing, reset and keyboard escape");
  } finally { await motion.close(); }
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 700, hasTouch: width < 700, reducedMotion: "reduce", locale: "en-US" });
    try {
      const page = await context.newPage(); await page.goto(`${base}/?dense`); await settle(page);
      assert.equal(await page.locator("[data-graph-node]").count(), 130);
      const labels = await page.locator(".graph-node-label").evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, r: rect.right, b: rect.bottom }; }));
      for (const [index, a] of labels.entries()) for (const b of labels.slice(index + 1)) assert.ok(a.r <= b.x + 1 || b.r <= a.x + 1 || a.b <= b.y + 1 || b.b <= a.y + 1, "overview labels do not overlap");
      const positions = await page.locator("[data-graph-node]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-graph-node"), node.getAttribute("transform")]).sort());
      await page.getByRole("button", { name: "Live update", exact: true }).click();
      assert.deepEqual(await page.locator("[data-graph-node]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-graph-node"), node.getAttribute("transform")]).sort()), positions, "status/order polling preserves settled coordinates");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (evidence) await page.screenshot({ path: join(evidence, `graph-dense-${width}.png`), animations: "disabled" });
      console.log(`PASS ${width}px: dense 130-node shared graph labels, polling continuity and overflow`);
    } finally { await context.close(); }
  }

  const sizing = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", locale: "en-US" });
  try {
    const page = await sizing.newPage(); await page.goto(`${base}/?sizing`); await settle(page);
    const hub = page.locator('[data-graph-node="sizing-hub"]'), leaf = page.locator('[data-graph-node="sizing-leaf-0"]');
    const radius = async (node: ReturnType<typeof page.locator>) => Number(await node.getAttribute("data-radius"));
    assert.ok(await radius(hub) / await radius(leaf) >= 1.7);
    const surface = page.locator(".graph-surface"), before = await surface.locator(":scope > g").getAttribute("transform");
    const box = (await hub.locator(".graph-node-disc").boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await sizing.newCDPSession(page);
    const hubBefore = await hub.getAttribute("transform");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 35, y: y + 25 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.notEqual(await hub.getAttribute("transform"), hubBefore, "touch dragging still moves a hub");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 100, y: 240 }, { x: 220, y: 240 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 70, y: 240 }, { x: 250, y: 240 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await hub.focus(); await page.keyboard.press("Enter");
    const heldBox = (await hub.locator(".graph-node-disc").boundingBox())!, hx = heldBox.x + heldBox.width / 2, hy = heldBox.y + heldBox.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: hx, y: hy }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: hx + 20, y: hy + 15 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: hx + 20, y: hy + 15 }, { id: 2, x: hx + 65, y: hy + 15 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: hx + 5, y: hy + 15 }, { id: 2, x: hx + 80, y: hy + 15 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    assert.equal(await hub.getAttribute("aria-pressed"), "true", "drag-to-pinch cancellation preserves selection");
    const releasedHub = await hub.getAttribute("transform");
    await page.getByRole("button", { name: "Add neighbour", exact: true }).click();
    await page.locator('[data-graph-node="new-neighbour"]').waitFor();
    assert.notEqual(await hub.getAttribute("transform"), releasedHub, "pinch takeover releases held coordinates for later topology layout");
    await cdp.detach();
    assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), before, "pinch zoom changes the viewport");
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const hit = (await leaf.locator(".graph-node-hit").boundingBox())!;
    assert.ok(hit.width >= 44 && hit.height >= 44, "zoomed-out terminals retain touch hit targets");
    await page.locator(".graph-kind-legend").getByRole("button", { name: "Terminal", exact: true }).click();
    assert.equal(await hub.getAttribute("data-degree"), "0");
    assert.equal(await radius(hub), 6);
    console.log("PASS rendered hub sizing, zoomed touch targets, connected touch drag and pinch takeover");
  } finally { await sizing.close(); }
  for (const future of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 844 }, reducedMotion: "reduce", locale: "en-US" });
    const bytes = future ? '{"version":99,"future":"keep"}' : JSON.stringify({ version: 3, layout: "force", selected: "workspace:retired", filters: { search: "", status: "", machine: "", focus: "", showCompleted: true, communication: "recent", hiddenKinds: ["worktree"] }, groupMachine: false, legendOpen: false, positions: { obsolete: { x: 9999, y: 9999 } }, viewport: { x: 1, y: 1, k: 0.1 } });
    await context.addInitScript(({ future, bytes }) => localStorage.setItem(future ? "ovis:graph:v4" : "ovis:graph:v3", bytes), { future, bytes });
    try {
      const page = await context.newPage(); await page.goto(base); await page.locator('[data-graph-node="session"]').waitFor();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      const stores = await page.evaluate(() => ({ old: localStorage.getItem("ovis:graph:v3"), current: localStorage.getItem("ovis:graph:v4") }));
      if (future) assert.equal(stores.current, bytes, "future v4 bytes cannot be overwritten by graph effects or gestures");
      else {
        assert.equal(stores.old, bytes, "v3 rollback bytes remain intact");
        const state = JSON.parse(stores.current!); assert.equal(state.version, 4); assert.equal(state.selected, ""); assert.equal(state.legendOpen, false); assert.deepEqual(state.filters.hiddenKinds, []); assert.equal(state.positions.obsolete, undefined);
      }
    } finally { await context.close(); }
  }
  console.log("PASS browser v3 migration, obsolete topology retirement and future-store write protection");
} finally {
  await browser?.close(); server?.stop(); rmSync(root, { recursive: true, force: true });
}
