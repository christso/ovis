/** Real Ovis App + real FlockStore/handler, using fictional roster/proofs/transport only. Not native or live-user dogfooding. */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import fixture from "../site/demo/fixtures/machines.json";
import type { Machine } from "../shared/machines.ts";
import { flockBinding } from "../shared/flock-inventory.ts";
import { FlockStore, handleFlockRequest } from "../server/flock.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

const videoDir = process.env.GRAPH_VIDEO_DIR;
const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const runs: readonly (readonly [number, "dark" | "light"])[] = videoDir ? [[1600, "dark"]] : [[1280, "dark"], [1280, "light"], [390, "dark"], [390, "light"]];
const root = mkdtempSync(join(tmpdir(), "ovis-graph-app-")), app = join(root, "app");
const original = structuredClone(fixture.machines[0]) as Machine;
const chosen = original.snapshot!.panes.find((pane) => pane.agent === "codex")!;
original.snapshot!.panes = [chosen]; original.snapshot!.herdr_lifetime = "graph-owned-local";
// Explicit fictional proof stands in for Table's native reader; the ordinary roster below omits it.
chosen.terminal_id = "graph-terminal-local";
original.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: chosen.terminal_id, agent: chosen.agent!, native_session_id: "graph-native-local" }];
chosen.agent_session = { agent: chosen.agent!, kind: "id", source: "fixture", value: "graph-native-local" }; chosen.agent_status = "working";
const remote = structuredClone(original); remote.id = "graph-remote"; remote.name = "Graph remote"; remote.kind = "ssh";
remote.snapshot!.herdr_lifetime = "graph-owned-remote";
remote.snapshot!.panes[0]!.terminal_id = "graph-terminal-remote";
remote.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: "graph-terminal-remote", agent: chosen.agent!, native_session_id: "graph-native-remote" }]; remote.snapshot!.panes[0]!.agent_session!.value = "graph-native-remote";
const offline = structuredClone(remote); offline.id = "graph-offline"; offline.name = "Graph offline"; offline.state = "disconnected";
const unknown = structuredClone(chosen); unknown.pane_id = "graph-unproven"; unknown.label = "Unproven garden"; unknown.agent_session = null;
original.snapshot!.panes.push(unknown);
const pristine: Machine[] = [original, remote, offline, { ...offline, id: "graph-empty", name: "Graph awaiting inventory", state: "connecting", snapshot: null }];
let machines = structuredClone(pristine), store = new FlockStore(join(root, "initial")), future = false, flockReads = 0;
let browser: Browser | undefined, server: ReturnType<typeof Bun.serve> | undefined;
const harness = (machines: Machine[]) => `<script>(() => {
  const raw = (values) => values.map(machine => ({...machine, snapshot:machine.snapshot ? {...machine.snapshot, flock_bindings:undefined} : null}));
  let fixture = raw(${JSON.stringify(machines)});
  const demo = window.fetch, network = window.graphNetwork, sources = new Set();
  const controls = [];
  window.graphFixture = { controls, setMachines(next) { fixture = raw(next); for (const source of sources) source.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({type:'machines', machines:fixture})})); } };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (['/api/pane/focus', '/api/pane/input', '/api/pane/send', '/api/pane/keys'].includes(url.pathname)) controls.push(url.pathname);
    if (url.pathname === '/api/flock') return network(input, init);
    if (url.pathname === '/api/fs/stat') return Response.json({path:'/fixture/README.md',name:'README.md',size:29,modified:'2026-11-07T00:00:00Z',mime:'text/markdown',kind:'text'});
    if (url.pathname === '/api/fs/file') return new Response('# Fictional Graph file\\n', {headers:{'content-type':'text/markdown'}});
    if (url.pathname === '/api/health' && url.searchParams.get('scope') === 'bridge' && new URLSearchParams(location.search).get('hold_auth') === '1') { await new Promise(resolve => { window.graphFixture.releaseAuth = resolve; }); return demo(input, init); }
    if (url.pathname === '/api/machines') return Response.json({machines:fixture});
    if (url.pathname === '/api/session') return Response.json({snapshot:fixture[0].snapshot});
    return demo(input, init);
  };
  const DemoSource = window.EventSource;
  window.EventSource = function(url, options) {
    if (!String(url).includes('/api/machines/events')) return new DemoSource(url, options);
    const source = new EventTarget(); source.readyState = 1; source.close = () => { source.readyState = 2; sources.delete(source); }; sources.add(source);
    queueMicrotask(() => source.dispatchEvent(new MessageEvent('message', {data:JSON.stringify({type:'machines', machines:fixture})})));
    return source;
  };
  const DemoSocket = window.WebSocket;
  window.WebSocket = class extends DemoSocket { send(raw) { try { const message = JSON.parse(raw); if (message.type === 'input' || message.type === 'keys') controls.push(message.type); } catch {} return super.send(raw); } };
})();</script>`;
try {
  await buildDemoApp(app);
  const html = readFileSync(join(app, "index.html"), "utf8");
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/flock") { flockReads++; return future ? Response.json({ version: 99 }) : handleFlockRequest(request, store, machines); }
    const prefix = "/herdr-web-ui/demo/app/";
    if (!path.startsWith(prefix)) return new Response("not found", { status: 404 });
    const file = decodeURIComponent(path.slice(prefix.length)) || "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    if (file === "index.html") return new Response(html.replace("</body>", `${videoDir ? `<div style="position:fixed;right:12px;bottom:8px;z-index:9999;pointer-events:none;padding:8px;background:var(--bg-panel);color:var(--text);border:1px solid var(--border);font-size:12px">Fictional roster/proofs · Graph · ${testedSha.slice(0, 10)}</div>` : ""}</body>`).replace(/<script type="module"/, () => `<script>window.graphNetwork = window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness(machines)}<script type="module"`), { headers: { "content-type": "text/html" } });
    const body = Bun.file(join(app, file)); return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, slowMo: videoDir ? 1300 : 0, args: ["--no-sandbox"] });
  for (const [width, theme] of runs) {
    machines = structuredClone(pristine); future = false; store = new FlockStore(join(root, `${width}-${theme}`));
    store.change(0, { type: "create-work", name: "Orchard work" }, machines);
    store.change(1, { type: "adopt", binding: flockBinding(machines[0]!, machines[0]!.snapshot!.panes[0]!)!, work_id: store.read().works[0]!.id, name: "Prune orchard" }, machines);
    const session = store.read().sessions[0]!, old = store.read().executions[0]!, sessionId = `session:${session.id}`;
    const context = await browser.newContext({ viewport: { width, height: videoDir ? 1000 : 844 }, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width, height: 1000 } } } : {}), locale: "en-US", colorScheme: theme, reducedMotion: "reduce", ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme, fileOpen: "panel" })), theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = [], assets: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message)); page.on("request", (request) => { if (request.url().includes("GraphPanel-")) assets.push(request.url()); });
    const base = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/`;
    const nav = page.getByRole("navigation", { name: "Views" });
    const openGraph = async () => {
      if (width === 390 && await page.getByRole("button", { name: "Open workspace list", exact: true }).isVisible()) {
        if (!(await page.locator("#workspace-drawer").getAttribute("class"))?.includes("is-open")) await page.getByRole("button", { name: "Open workspace list", exact: true }).click();
      }
      await nav.getByRole("button", { name: "Graph", exact: true }).click();
    };
    const node = () => page.locator(`[data-graph-node="${sessionId}"]`);
    const inspect = async (id: string) => { await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption(id); };
    let stage = "initial";
    try {
      await page.goto(`${base}?pane=${encodeURIComponent(chosen.pane_id)}&view=terminal`);
      if (width === 390) await page.getByRole("button", { name: "Open workspace list", exact: true }).waitFor();
      else await nav.getByRole("button", { name: "Graph", exact: true }).waitFor();
      assert.equal(assets.length, 0, "Graph dependencies do not load in Workspace");
      const beforePane = new URL(page.url()).searchParams.get("pane");
      await openGraph(); await node().waitFor(); assert.ok(assets.length > 0, "Graph is a lazy chunk");
      assert.equal(new URL(page.url()).searchParams.get("pane"), beforePane);
      await page.getByText(/Inventory is incomplete for:.*Graph awaiting inventory/).waitFor();
      await inspect(sessionId); const position = await node().getAttribute("transform");
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isEnabled(), true, "shared proof-backed source authorizes the live target");
      const proofs = machines[0]!.snapshot!.flock_bindings!;
      machines[0]!.snapshot!.flock_bindings = [];
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === true);
      machines[0]!.snapshot!.flock_bindings = proofs;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === false);

      await page.getByLabel("Search graph", { exact: true }).fill("Prune orchard");
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("working");
      await page.getByRole("combobox", { name: "Focus graph", exact: true }).selectOption(sessionId);
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      const surface = page.getByRole("group", { name: "Interactive graph", exact: true });
      const beforePan = await surface.locator(":scope > g").getAttribute("transform");
      if (width !== 390) {
        const box = await surface.boundingBox(); assert.ok(box);
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 }); await page.mouse.up();
      } else { await surface.focus(); await page.keyboard.press("ArrowRight"); }
      assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), beforePan, "integrated graph pans");
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      await page.getByRole("combobox", { name: "Focus graph", exact: true }).selectOption("");
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("");
      await nav.getByRole("button", { name: "Table", exact: true }).click();
      await nav.getByRole("button", { name: "Graph", exact: true }).click();
      await node().waitFor(); assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "Prune orchard");
      const share = page.url(); assert.equal(new URL(share).searchParams.get("page"), "graph");
      await page.reload(); await node().waitFor(); assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.equal(new URL(page.url()).searchParams.get("view"), new URL(share).searchParams.get("view"), "Graph location preserves the chosen pane lens");
      await page.getByLabel("Search graph", { exact: true }).fill("");
      // Current execution moves explicitly; previous execution remains live on an equal pane ID.
      store.change(store.read().revision, { type: "adopt", binding: flockBinding(machines[1]!, machines[1]!.snapshot!.panes[0]!)!, session_id: session.id }, machines);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.locator(`[data-graph-node="execution:${store.read().sessions[0]!.current_execution_id}"]`).waitFor();
      assert.equal(await node().getAttribute("transform"), position, "execution move preserves logical node layout");
      if (width >= 980) {
        const withFile = new URL(page.url()); withFile.searchParams.delete("page"); withFile.searchParams.set("file", "README.md");
        await page.goto(withFile.href);
        await page.locator("aside.file-panel .file-viewer").waitFor();
        await openGraph(); await node().waitFor(); await inspect(sessionId);
      }
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && url.searchParams.get("pane") === chosen.pane_id && !url.searchParams.has("page"));
      if (videoDir) {
        await page.getByRole("group", { name: "Pane view", exact: true }).getByRole("button", { name: "Terminal", exact: true }).click();
        await page.waitForURL((url) => url.searchParams.get("view") === "terminal" && url.searchParams.get("machine") === remote.id);
      }
      stage = "back-cross"; await page.goBack(); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph", "Back after opening another machine restores Graph");
      assert.equal(await node().getAttribute("aria-pressed"), "true");
      stage = "forward"; await page.goForward();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && !url.searchParams.has("page"));
      await openGraph(); await inspect(sessionId);
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && !url.searchParams.has("page"));
      await page.goBack(); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph", "Back after opening the already selected target restores Graph");
      stage = "forward"; await page.goForward();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && !url.searchParams.has("page"));
      const linked = await context.newPage();
      await linked.goto(share); await linked.locator(`[data-graph-node="${sessionId}"]`).waitFor();
      assert.equal(new URL(linked.url()).searchParams.get("page"), "graph", "a copied Graph link lands on Graph even after a different terminal was selected");
      assert.equal(new URL(linked.url()).searchParams.get("machine"), null);
      await linked.close();
      await openGraph(); await inspect(`execution:${old.id}`);
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => !url.searchParams.has("machine") && url.searchParams.get("pane") === chosen.pane_id && !url.searchParams.has("page"));
      await openGraph(); await inspect(sessionId);
      machines[1]!.state = "disconnected";
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === true);
      assert.equal(await node().getAttribute("transform"), position, "disconnect leaves layout intact");
      machines[1]!.state = "connected"; machines[1]!.snapshot!.panes[0]!.terminal_id = "graph-reused-terminal";
      machines[1]!.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: "graph-reused-terminal", agent: chosen.agent!, native_session_id: "reused-native" }];
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true, "reused native identity cannot navigate");
      const unproven = await page.getByRole("combobox", { name: "Inspect node", exact: true }).locator("option").evaluateAll((options) => options.find((option) => option.textContent?.includes("Unproven garden"))?.getAttribute("value"));
      assert.ok(unproven); await inspect(unproven);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true);
      await page.getByText("Identity unavailable", { exact: true }).last().waitFor();
      future = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByText(/format cannot be read/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).count(), 0, "unreadable registry exposes no terminal action");
      future = false; await page.getByRole("button", { name: "Refresh", exact: true }).click(); await node().waitFor();
      // Browser history restores the Graph page and its filters, without selecting Herdr focus.
      await page.getByLabel("Search graph", { exact: true }).fill("Prune orchard");
      await nav.getByRole("button", { name: "Table", exact: true }).click();
      await page.goBack(); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph");
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "Prune orchard");
      assert.deepEqual(await page.evaluate(() => (window as unknown as { graphFixture: { controls: string[] } }).graphFixture.controls), [], "Graph/navigation never focuses or inputs to Herdr");
      assert.deepEqual(errors, []);
      if (process.env.UI_EVIDENCE_DIR) { const path = join(process.env.UI_EVIDENCE_DIR, "graph-app"); mkdirSync(path, { recursive: true }); await page.screenshot({ path: join(path, `${width}-${theme}.png`) }); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Graph stays within viewport");
      console.log(`PASS real App Graph ${width} ${theme}: shared inventory, lazy load, current execution, state/history/deep link, disconnect/reuse, incomplete/future sources`);
      machines = machines.map((machine) => ({ ...machine, state: "disconnected", snapshot: null }));
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      await nav.getByRole("button", { name: "Workspace", exact: true }).click();
      await page.waitForURL((url) => !url.searchParams.has("page"));
      await openGraph();
      await page.waitForURL((url) => url.searchParams.get("page") === "graph");
      await page.reload(); await node().waitFor();
      await inspect(sessionId);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true, "Graph and its deep link remain available with every source incomplete");
      // Watch role may access neither the private registry nor the Graph chunk/metadata.
      await nav.getByRole("button", { name: "Workspace", exact: true }).click();
      const reads = flockReads, watch = await context.newPage();
      const watchAssets: string[] = []; watch.on("request", (request) => { if (request.url().includes("GraphPanel-")) watchAssets.push(request.url()); });
      await watch.goto(`${base}?page=graph&demo_devices=watch&hold_auth=1`);
      await watch.waitForFunction(() => typeof (window as unknown as { graphFixture: { releaseAuth?: () => void } }).graphFixture?.releaseAuth === "function");
      assert.equal(flockReads, reads, "unknown role does not fetch the private registry"); assert.deepEqual(watchAssets, [], "unknown role does not fetch Graph code");
      await watch.evaluate(() => (window as unknown as { graphFixture: { releaseAuth(): void } }).graphFixture.releaseAuth());
      await watch.getByText("This device can only watch", { exact: true }).waitFor();
      assert.equal(await watch.locator(".graph-view").count(), 0); assert.equal(flockReads, reads); assert.deepEqual(watchAssets, []);
      await watch.close();
    } catch (error) {
      console.error("Graph fixture failed", stage, page.url(), errors, await page.locator("body").innerText());
      throw error;
    } finally {
      const video = page.video(); await context.close();
      if (videoDir && video) writeFileSync(join(videoDir, "graph-recording.json"), JSON.stringify({ testedSha, source: "real Ovis App + fictional roster/native ownership proofs + real isolated FlockStore/handler", video: await video.path(), width, theme }, null, 2));
    }
  }
} finally { await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true }); }
