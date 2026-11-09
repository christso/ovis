/** Real Ovis App + real FlockStore/handler, using fictional roster/proofs/transport only. Not native or live-user dogfooding. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { openFlock, openNativeAgent } from "./flock-navigation.ts";

const videoDir = process.env.GRAPH_VIDEO_DIR;
const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const diffSha256 = createHash("sha256").update(sourceDiff).digest("hex");
const sourceFingerprint = `${testedSha}+${diffSha256}`;
const runs: readonly (readonly [number, number, "dark" | "light"])[] = videoDir ? [[Number(process.env.GRAPH_VIDEO_WIDTH ?? 1600), Number(process.env.GRAPH_VIDEO_HEIGHT ?? 1000), "dark"]] : [1280, 390, 320].flatMap((width) => (width === 1280 ? [844] : [844, 640]).flatMap((height) => (["dark", "light"] as const).map((theme) => [width, height, theme] as const)));
const root = mkdtempSync(join(tmpdir(), "ovis-graph-app-")), app = join(root, "app");
const original = structuredClone(fixture.machines[0]) as Machine;
const chosen = original.snapshot!.panes.find((pane) => pane.agent === "codex")!;
original.snapshot!.panes = [chosen]; original.snapshot!.herdr_lifetime = `demo-${original.id}`;
// Explicit fictional proof stands in for the native reader; the ordinary roster below omits it.
chosen.terminal_id = "graph-terminal-local";
const nativeSourceId = "11111111-1111-4111-8111-111111111111", nativeChildId = "22222222-2222-4222-8222-222222222222";
original.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: chosen.terminal_id, agent: chosen.agent!, native_session_id: nativeSourceId }];
chosen.agent_session = { agent: chosen.agent!, kind: "id", source: "fixture", value: nativeSourceId }; chosen.agent_status = "working";
original.snapshot!.flock_observations = ["delegation", "communication", "communication"].map((kind, index) => ({ id: `graph-receipt-${index}`, kind: kind as "delegation" | "communication", source_native_session_id: nativeSourceId, target_native_session_id: nativeChildId, occurred_at: new Date(Date.now() - 60_000 * (3 - index)).toISOString(), source: "codex" }));
const remote = structuredClone(original); remote.id = "graph-remote"; remote.name = "Graph remote"; remote.kind = "ssh";
remote.snapshot!.herdr_lifetime = "graph-owned-remote";
remote.snapshot!.panes[0]!.terminal_id = "graph-terminal-remote";
remote.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: "graph-terminal-remote", agent: chosen.agent!, native_session_id: "graph-native-remote" }]; remote.snapshot!.panes[0]!.agent_session!.value = "graph-native-remote";
const offline = structuredClone(remote); offline.id = "graph-offline"; offline.name = "Graph offline"; offline.state = "disconnected";
const unknown = structuredClone(chosen); unknown.pane_id = "graph-unproven"; unknown.label = "Unproven garden"; unknown.agent_session = null;
original.snapshot!.panes.push(unknown);
const researchTab = { ...original.snapshot!.tabs.find((tab) => tab.tab_id === chosen.tab_id)!, tab_id: "graph-research-tab", label: "research" };
unknown.tab_id = researchTab.tab_id;
original.snapshot!.tabs.push(researchTab);
const idlePane = { ...chosen, pane_id: "graph-idle-pane", tab_id: "graph-idle-tab", terminal_id: "graph-idle-terminal", agent: null, agent_status: "idle", agent_session: null };
original.snapshot!.panes.push(idlePane);
original.snapshot!.tabs.push({ ...researchTab, tab_id: idlePane.tab_id, label: "ai-research" });
const pristine: Machine[] = [original, remote, offline, { ...offline, id: "graph-empty", name: "Graph awaiting inventory", state: "connecting", snapshot: null }];
let machines = structuredClone(pristine), store = new FlockStore(join(root, "initial")), future = false, flockReads = 0;
let browser: Browser | undefined, server: ReturnType<typeof Bun.serve> | undefined;
const harness = (machines: Machine[]) => `<script>(() => {
  const raw = (values) => values.map(machine => ({...machine, snapshot:machine.snapshot ? {...machine.snapshot, flock_bindings:undefined, flock_observations:undefined} : null}));
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
    if (file === "index.html") return new Response(html.replace("</body>", `${videoDir ? `<div style="position:fixed;right:8px;bottom:4px;z-index:9999;pointer-events:none;padding:4px;background:var(--bg-panel);color:var(--text);border:1px solid var(--border);font-size:10px">Fixture · Graph · ${testedSha.slice(0, 8)}+${diffSha256.slice(0, 8)}</div>` : ""}</body>`).replace(/<script type="module"/, () => `<script>window.graphNetwork = window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness(machines)}<script type="module"`), { headers: { "content-type": "text/html" } });
    const body = Bun.file(join(app, file)); return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, slowMo: videoDir ? 350 : 0, args: ["--no-sandbox"] });
  for (const [width, height, theme] of runs) {
    const mobile = width <= 700;
    machines = structuredClone(pristine); future = false; store = new FlockStore(join(root, `${width}-${height}-${theme}`));
    store.change(0, { type: "create-work", name: "Orchard work" }, machines);
    store.change(1, { type: "adopt", binding: flockBinding(machines[0]!, machines[0]!.snapshot!.panes[0]!)!, work_id: store.read().works[0]!.id, name: "Prune orchard" }, machines);
    const session = store.read().sessions[0]!, old = store.read().executions[0]!, sessionId = `session:${session.id}`;
    const context = await browser.newContext({ viewport: { width, height }, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width, height } } } : {}), locale: "en-US", colorScheme: theme, reducedMotion: "reduce", ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme, fileOpen: "panel" })), theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = [], assets: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message)); page.on("request", (request) => { if (request.url().includes("GraphPanel-")) assets.push(request.url()); });
    const base = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/`;
    const openGraph = () => openFlock(page);
    const node = () => page.locator(`[data-graph-node="${sessionId}"]`);
    const options = async (open: boolean) => {
      const button = page.getByRole("button", { name: /^Graph filters/ });
      if (mobile && await button.getAttribute("aria-expanded") !== String(open)) await button.click();
    };
    const inspect = async (id: string) => { await options(true); await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption(id); await options(false); };
    let stage = "initial";
    try {
      await page.goto(`${base}?pane=${encodeURIComponent(chosen.pane_id)}&view=terminal`);
      if (mobile) await page.getByRole("button", { name: "Open workspace list", exact: true }).waitFor();
      else await page.getByRole("button", { name: "Flock", exact: true }).waitFor();
      assert.equal(assets.length, 0, "Graph dependencies do not load in Workspace");
      await page.getByRole("group", { name: "Pane view", exact: true }).waitFor();
      if (width >= 980) await page.getByRole("button", { name: "Browse files", exact: true }).waitFor();
      const beforePane = new URL(page.url()).searchParams.get("pane");
      await openFlock(page);
      await node().waitFor();
      const researchNode = page.locator('[data-graph-node][aria-label^="research · codex"]');
      await researchNode.waitFor();
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      assert.equal(await researchNode.locator(".graph-node-label").textContent(), "research · codex", "an explicit tab name remains visible before generic context labels");
      const idleTab = page.locator('[data-graph-node][aria-label^="ai-research ·"]');
      await idleTab.waitFor();
      await idleTab.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("pane") === idlePane.pane_id && !url.searchParams.has("page"));
      await openFlock(page); await node().waitFor();
      assert.equal(await page.getByRole("group", { name: "Flock view", exact: true }).count(), 0, "Flock opens the graph directly without a mode selector");
      assert.equal(await page.getByRole("banner").count(), 1, "Flock keeps one global app banner");
      assert.equal(await page.locator(".app-header .context-title-text").innerText(), "Flock", "the global header names the active graph");
      await page.getByRole("button", { name: /^More(?: · alerts are off)?$/ }).click();
      assert.equal(await page.getByRole("menuitem", { name: "Find in terminal", exact: true }).count(), 0);
      assert.equal(await page.getByRole("menuitem", { name: "Browse files", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("group", { name: "Pane view", exact: true }).count(), 0, "Flock hides pane-only controls");
      assert.equal(await page.getByRole("button", { name: "Browse files", exact: true }).count(), 0, "pane-only Files control stays with the workspace");
      assert.equal(await page.locator(".agents-sidebar").count(), 1, "only the native Agents section exists");
      assert.equal(await page.getByRole("navigation", { name: "Views", exact: true }).count(), 0, "no duplicate global view navigation");
      if (mobile) assert.ok(!(await page.locator("#workspace-drawer").getAttribute("class"))?.includes("is-open"), "Flock closes the phone drawer");
      assert.ok(assets.length > 0, "opening Flock lazily loads Graph");
      await openGraph(); await node().waitFor(); assert.ok(assets.length > 0, "Graph is a lazy chunk");
      await openNativeAgent(page, "local", chosen.pane_id);
      await page.waitForURL((url) => !url.searchParams.has("page"));
      await page.getByRole("group", { name: "Pane view", exact: true }).waitFor();
      if (mobile) assert.notEqual(await page.locator(".app-header .context-title-text").innerText(), "Flock", "native pane selection restores its title");
      else assert.equal(await page.locator('.app-header [role="tab"][aria-selected="true"]').getAttribute("data-tab-id"), chosen.tab_id, "native pane selection restores its header tab");
      if (width >= 980) await page.getByRole("button", { name: "Browse files", exact: true }).waitFor();
      await openFlock(page); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph");
      if (mobile) await page.getByRole("button", { name: "Open workspace list", exact: true }).click();
      await page.getByRole("region", { name: `PC ${original.name}`, exact: true }).locator(`.workspace-select[data-pane="${chosen.pane_id}"]`).click();
      await page.waitForURL((url) => !url.searchParams.has("page"));
      await openFlock(page); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph");
      assert.equal(await page.getByRole("button", { name: "Flock", exact: true, includeHidden: true }).getAttribute("aria-current"), "page");
      assert.equal(new URL(page.url()).searchParams.get("pane"), beforePane);
      await page.getByText(/Inventory is incomplete for:.*Graph awaiting inventory/).waitFor();
      await inspect(sessionId);
      await page.locator(".graph-edge-delegation").waitFor({ state: "attached" });
      assert.equal(await page.locator(".graph-edge-communication").count(), 1, "repeated native sends update one connection");
      assert.ok(await page.locator(".graph-edge-delegation line").getAttribute("marker-end"), "observed delegation shows direction");
      await options(true);
      const communication = page.getByRole("combobox", { name: "Communication links", exact: true });
      await communication.selectOption("none"); assert.equal(await page.locator(".graph-edge-communication").count(), 0);
      await communication.selectOption("all"); assert.equal(await page.locator(".graph-edge-communication").count(), 1);
      await communication.selectOption("recent"); await options(false);
      await inspect(`native:${JSON.stringify([original.id, "codex", nativeChildId])}`);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true, "an observed child without a proven pane cannot open a terminal");
      await inspect(sessionId);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isEnabled(), true, "shared proof-backed source authorizes the live target");
      const proofs = machines[0]!.snapshot!.flock_bindings!;
      machines[0]!.snapshot!.flock_bindings = [];
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === true);
      machines[0]!.snapshot!.flock_bindings = proofs;
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === false);
      if (process.env.UI_EVIDENCE_DIR) {
        const path = join(process.env.UI_EVIDENCE_DIR, "graph-app-mobile"); mkdirSync(path, { recursive: true });
        await page.screenshot({ path: join(path, `${width}-${height}-${theme}-initial.png`) });
      }

      await page.getByLabel("Search graph", { exact: true }).fill("Prune orchard");
      await options(true);
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("working");
      await page.getByRole("combobox", { name: "Focus graph", exact: true }).selectOption(sessionId);
      await options(false);
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      const surface = page.getByRole("group", { name: "Interactive graph", exact: true });
      const beforePan = await surface.locator(":scope > g").getAttribute("transform");
      if (!mobile) {
        const box = await surface.boundingBox(); assert.ok(box);
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x + 120, box.y + 80, { steps: 6 }); await page.mouse.up();
      } else { await surface.focus(); await page.keyboard.press("ArrowRight"); }
      assert.notEqual(await surface.locator(":scope > g").getAttribute("transform"), beforePan, "integrated graph pans");
      await page.getByRole("button", { name: "Fit graph", exact: true }).click();
      await options(true);
      await page.getByRole("combobox", { name: "Focus graph", exact: true }).selectOption("");
      await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("");
      await options(false);
      await openNativeAgent(page, "local", chosen.pane_id);
      await openGraph();
      await node().waitFor(); assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "Prune orchard");
      const share = page.url(); assert.equal(new URL(share).searchParams.get("page"), "graph");
      await page.reload(); await node().waitFor(); assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.equal(new URL(page.url()).searchParams.get("view"), new URL(share).searchParams.get("view"), "Graph location preserves the chosen pane lens");
      await page.getByLabel("Search graph", { exact: true }).fill("");
      // Current execution moves explicitly; previous execution remains live on an equal pane ID.
      machines[1]!.snapshot!.flock_bindings![0]!.native_session_id = nativeSourceId;
      machines[1]!.snapshot!.panes[0]!.agent_session!.value = nativeSourceId;
      machines[1]!.snapshot!.flock_observations = structuredClone(original.snapshot!.flock_observations);
      store.change(store.read().revision, { type: "adopt", binding: flockBinding(machines[1]!, machines[1]!.snapshot!.panes[0]!)!, session_id: session.id }, machines);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.locator(`[data-graph-node="execution:${store.read().sessions[0]!.current_execution_id}"]`).waitFor();
      assert.equal(store.read().observations?.length, 3, "replaying the copied rollout on its destination does not import receipts twice");
      assert.equal(await page.locator(".graph-edge-communication").count(), 1, "the logical connection survives a move without duplicate links");
      assert.equal(await node().getAttribute("aria-pressed"), "true", "execution changes preserve logical selection");
      if (width >= 980) {
        const withFile = new URL(page.url()); withFile.searchParams.delete("page"); withFile.searchParams.set("file", "README.md");
        await page.goto(withFile.href);
        await page.locator("aside.file-panel .file-viewer").waitFor();
        await openGraph(); await node().waitFor(); await inspect(sessionId);
      }
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && url.searchParams.get("pane") === chosen.pane_id && !url.searchParams.has("page"));
      if (videoDir) {
        await page.getByRole("group", { name: "Pane view", exact: true }).getByTitle(/^Live terminal/).click();
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
      await linked.goto(`${base}?page=table&pane=${encodeURIComponent(chosen.pane_id)}&view=terminal`);
      await linked.getByRole("region", { name: "Graph", exact: true }).waitFor();
      assert.equal(new URL(linked.url()).searchParams.get("pane"), chosen.pane_id, "legacy Table deep links map to Graph and retain the pane target");
      await linked.goto(`${base}?page=agents&pane=${encodeURIComponent(chosen.pane_id)}&view=terminal`);
      await linked.waitForURL((url) => !url.searchParams.has("page"));
      assert.equal(new URL(linked.url()).searchParams.get("pane"), chosen.pane_id, "legacy Agents links keep the pane target");
      assert.equal(await linked.locator(".agents-sidebar").count(), 1);
      assert.equal(await linked.locator(".flock-agents").count(), 0);
      await linked.close();
      await openGraph(); await inspect(`execution:${old.id}`);
      await page.getByRole("button", { name: "Open in Workspace", exact: true }).click();
      await page.waitForURL((url) => !url.searchParams.has("machine") && url.searchParams.get("pane") === chosen.pane_id && !url.searchParams.has("page"));
      await openGraph(); await inspect(sessionId);
      machines[1]!.state = "disconnected";
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      await page.waitForFunction(() => (document.querySelector('.graph-details button') as HTMLButtonElement)?.disabled === true);
      assert.equal(await node().getAttribute("aria-pressed"), "true", "disconnect preserves logical selection");
      machines[1]!.state = "connected"; machines[1]!.snapshot!.panes[0]!.terminal_id = "graph-reused-terminal";
      machines[1]!.snapshot!.flock_bindings = [{ pane_id: chosen.pane_id, terminal_id: "graph-reused-terminal", agent: chosen.agent!, native_session_id: "reused-native" }];
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true, "reused native identity cannot navigate");
      await options(true);
      const unproven = await page.getByRole("combobox", { name: "Inspect node", exact: true }).locator("option").evaluateAll((options) => options.find((option) => option.textContent?.includes("research · codex"))?.getAttribute("value"));
      assert.ok(unproven); await inspect(unproven);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true);
      await page.getByText("Identity unavailable", { exact: true }).last().waitFor();
      future = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByText(/format cannot be read/).waitFor();
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).count(), 0, "unreadable registry exposes no terminal action");
      future = false; await page.getByRole("button", { name: "Refresh", exact: true }).click(); await node().waitFor();
      // Browser history restores the Graph page and its filters, without selecting Herdr focus.
      await page.getByLabel("Search graph", { exact: true }).fill("Prune orchard");
      await openNativeAgent(page, "local", chosen.pane_id);
      await page.goBack(); await node().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("page"), "graph");
      assert.equal(await page.getByLabel("Search graph", { exact: true }).inputValue(), "Prune orchard");
      assert.deepEqual(await page.evaluate(() => (window as unknown as { graphFixture: { controls: string[] } }).graphFixture.controls), [], "Graph/navigation never focuses or inputs to Herdr");
      assert.deepEqual(errors, []);
      if (process.env.UI_EVIDENCE_DIR) { const path = join(process.env.UI_EVIDENCE_DIR, "graph-app-mobile"); mkdirSync(path, { recursive: true }); await page.screenshot({ path: join(path, `${width}-${height}-${theme}.png`) }); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Graph stays within viewport");
      console.log(`PASS real App Graph ${width} ${theme}: shared inventory, lazy load, current execution, state/history/deep link, disconnect/reuse, incomplete/future sources`);
      await openNativeAgent(page, "local", chosen.pane_id);
      await page.waitForURL((url) => !url.searchParams.has("page"));
      machines = machines.map((machine) => ({ ...machine, state: "disconnected", snapshot: null }));
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      await openGraph();
      await page.waitForURL((url) => url.searchParams.get("page") === "graph");
      await page.reload(); await node().waitFor();
      await inspect(sessionId);
      assert.equal(await page.getByRole("button", { name: "Open in Workspace", exact: true }).isDisabled(), true, "Graph and its deep link remain available with every source incomplete");
      // Watch role may access neither the private registry nor the Graph chunk/metadata.
      await page.goto(`${base}?pane=${encodeURIComponent(chosen.pane_id)}&view=terminal`);
      const reads = flockReads, watch = await context.newPage();
      const watchAssets: string[] = []; watch.on("request", (request) => { if (request.url().includes("GraphPanel-")) watchAssets.push(request.url()); });
      await watch.goto(`${base}?page=graph&demo_devices=watch&hold_auth=1`);
      await watch.waitForFunction(() => typeof (window as unknown as { graphFixture: { releaseAuth?: () => void } }).graphFixture?.releaseAuth === "function");
      assert.equal(flockReads, reads, "unknown role does not fetch the private registry"); assert.deepEqual(watchAssets, [], "unknown role does not fetch Graph code");
      await watch.evaluate(() => (window as unknown as { graphFixture: { releaseAuth(): void } }).graphFixture.releaseAuth());
      await watch.getByText("This device can only watch", { exact: true }).waitFor();
      assert.equal(await watch.locator(".graph-view").count(), 0); assert.equal(flockReads, reads); assert.deepEqual(watchAssets, []);
      assert.equal(await watch.getByRole("button", { name: "Flock", exact: true }).count(), 0, "watch role has no Flock entry");
      await watch.close();
      stage = "empty inventory reload";
      store = new FlockStore(join(root, `empty-${width}-${height}-${theme}`));
      await page.evaluate(() => localStorage.removeItem("ovis:graph:v1"));
      await page.goto(`${base}?page=graph`);
      await page.getByText("No graph nodes match these filters.", { exact: true }).waitFor();
      await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem("ovis:graph:v1") ?? "null")?.positions ?? {}).length === 0);
      await page.reload(); await page.locator(".graph-surface").waitFor();
      machines = structuredClone(pristine);
      await page.evaluate((next) => (window as unknown as { graphFixture: { setMachines(machines: Machine[]): void } }).graphFixture.setMachines(next), machines);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.waitForFunction(() => {
        const stage = document.querySelector(".graph-surface")!.getBoundingClientRect();
        return [...document.querySelectorAll("[data-graph-node]")].some((node) => { const box = node.getBoundingClientRect(); return box.x >= stage.x && box.right <= stage.right && box.y >= stage.y && box.bottom <= stage.bottom; });
      });
      console.log(`PASS empty inventory reload ${width}x${height} ${theme}: later inventory gets an initial frame`);
    } catch (error) {
      console.error("Graph fixture failed", stage, page.url(), errors, await page.locator("body").innerText());
      throw error;
    } finally {
      const video = page.video(); await context.close();
      if (videoDir && video) {
        writeFileSync(join(videoDir, "source.diff"), sourceDiff);
        writeFileSync(join(videoDir, "graph-recording.json"), JSON.stringify({ testedSha, diffSha256, sourceFingerprint, source: "real Ovis App + fictional roster/native ownership proofs + real isolated FlockStore/handler", video: await video.path(), width, height, theme }, null, 2));
      }
    }
  }
} finally { await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true }); }
