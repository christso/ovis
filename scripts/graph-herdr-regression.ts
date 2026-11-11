/** Real App, GraphRegistryStore and Move HTTP/filesystem flow. Herdr/native identity and receipt fixtures are explicitly fictional. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import roster from "../site/demo/fixtures/machines.json";
import type { HerdrCoordinationEndpoint } from "../shared/graph-registry.ts";
import { graphRegistryInventory } from "../shared/graph-registry-inventory.ts";
import { graphTerminals } from "../src/features/graph/graphTerminals.ts";
import type { Machine } from "../shared/machines.ts";
import { handleGraphRequest } from "../server/graph-registry.ts";
import { moveFlowFixture } from "../server/session-move/flow.fixture.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";
import { openGraph } from "./graph-navigation.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-graph-integration-")), app = join(root, "app");
const evidence = process.env["UI_EVIDENCE_DIR"];
const videoDirectory = process.env["GRAPH_HERDR_VIDEO_DIR"];
const cases = [[1280, "dark"], [390, "dark"], [320, "light"]] as const;
const results: unknown[] = [];
let browser: Browser | undefined;

/** The ordinary roster omits the private proof metadata returned only by the Graph source read. */
function publicMachines(machines: readonly Machine[]): Machine[] {
  return machines.map((machine) => ({ ...machine, snapshot: machine.snapshot ? { ...machine.snapshot, flock_bindings: undefined, flock_observations: undefined, flock_coordination: undefined } : null }));
}
const harness = `<script>(() => {
  const network=window.graphNetwork,demo=window.fetch;
  window.graphProof={reads:0,controls:[]};
  window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(['/api/pane/focus','/api/pane/input','/api/pane/send','/api/pane/keys'].includes(url.pathname))window.graphProof.controls.push(url.pathname);
    if(url.pathname==='/api/flock'){const response=await network(input,init);window.graphProof.reads++;return response;}
    return ['/api/session-moves','/api/machines','/api/session'].includes(url.pathname)?network(input,init):demo(input,init);
  };
  const Original=window.EventSource;
  window.EventSource=function(url,options){
    if(!String(url).includes('/api/machines/events'))return new Original(url,options);
    const source=new EventTarget();source.readyState=1;let pending=false,last='';
    const emit=async()=>{if(pending||source.readyState!==1)return;pending=true;try{
      const response=await network('/api/machines');const value=await response.json();
      const data=JSON.stringify({type:'machines',machines:value.machines});
      if(source.readyState===1&&data!==last){last=data;source.dispatchEvent(new MessageEvent('message',{data}));}
    }finally{pending=false;}};
    const timer=setInterval(emit,400);source.close=()=>{source.readyState=2;clearInterval(timer);};queueMicrotask(emit);return source;
  };
})();</script>`;

async function inspect(page: Page, id: string, mobile: boolean): Promise<void> {
  const filters = page.getByRole("button", { name: /^Graph filters/ });
  if (mobile) await filters.click();
  await page.getByRole("combobox", { name: "Inspect node", exact: true }).selectOption(id);
  if (mobile) await filters.click();
}

try {
  await buildDemoApp(app);
  const html = readFileSync(join(app, "index.html"), "utf8").replace(/<script type="module"/, () => `<script>window.graphNetwork=window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness}<script type="module"`);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const [width, theme] of cases) {
    if (process.env["GRAPH_HERDR_CASE"] && process.env["GRAPH_HERDR_CASE"] !== `${width}-${theme}`) continue;
    const flow = await moveFlowFixture();
    const session = flow.registry.sessions[0]!, sourceExecution = flow.registry.executions[0]!;

    const parent: HerdrCoordinationEndpoint = { server_id: "fixture-source-server", boot_id: "fixture-source-boot", terminal_id: "owned-terminal-source", agent_instance_id: "fixture-source-occupancy", agent: "codex", pane_id: "owned:p0", name: "Coordinator" };
    const worker: HerdrCoordinationEndpoint = { ...parent, terminal_id: "owned-worker-terminal", agent_instance_id: "fixture-worker-occupancy", agent: "claude", pane_id: "owned:p1", name: "Review worker" };
    let workerOccupancy = worker.agent_instance_id;
    const destination: HerdrCoordinationEndpoint = { ...parent, server_id: "fixture-destination-server", boot_id: "fixture-destination-boot", terminal_id: "owned-terminal-destination", agent_instance_id: "fixture-destination-occupancy" };
    const receipts = ["delegation", "communication", "communication"].map((kind, index) => ({ id: `fixture-operation-${index}`, kind: kind as "delegation" | "communication", source: parent, target: worker, occurred_at: new Date(Date.now() - 60_000 * (3 - index)).toISOString() }));
    const base = structuredClone(roster.machines[0]!) as Machine;
    const template = base.snapshot!.panes.find((pane) => pane.agent === "codex")!;
    const machines = (): Machine[] => [base, ...flow.machines().map((machine) => {
      const raw = machine.snapshot!, pane = { ...template, ...raw.panes[0]!, tab_id: "owned-tab" };
      const source = machine.id === "owned-source";
      const agents = source ? [...(pane.agent ? [parent] : []), { ...worker, agent_instance_id: workerOccupancy }] : pane.agent ? [destination] : [];
      const panes = source ? [pane, { ...pane, pane_id: worker.pane_id, terminal_id: worker.terminal_id, tab_id: "worker-tab", agent: worker.agent, agent_status: "idle" as const, agent_session: null, label: worker.name }] : [pane];
      return { ...machine, snapshot: { ...base.snapshot!, ...raw,
        workspaces: [{ ...base.snapshot!.workspaces[0]!, ...raw.workspaces[0] }], tabs: [{ ...base.snapshot!.tabs[0]!, workspace_id: "owned-workspace", tab_id: "owned-tab", label: "coordinator" }, ...(source ? [{ ...base.snapshot!.tabs[0]!, workspace_id: "owned-workspace", tab_id: "worker-tab", label: "review" }] : [])], panes,
        flock_coordination: { version: 1 as const, server_id: source ? parent.server_id : destination.server_id, boot_id: source ? parent.boot_id : destination.boot_id, agents, receipts: source ? receipts : [], cursor: null },
      } };
    })];
    const tabId = (machineId: string, nativeTab = "owned-tab") => {
      const sources = machines();
      return graphTerminals(sources, {}, undefined, graphRegistryInventory(flow.graphRegistry.read(), sources)).find((tab) => tab.machine.id === machineId && tab.panes[0]?.tab_id === nativeTab)!.node.id;
    };
    let selectedTabId = tabId("owned-source");
    const mobile = width < 700, viewport = { width, height: 844 };
    const context = await browser.newContext({ viewport, locale: "en-US", colorScheme: theme, reducedMotion: "reduce", ...(mobile ? { isMobile: true, hasTouch: true } : {}), ...(videoDirectory ? { recordVideo: { dir: videoDirectory, size: viewport } } : {}) });
    await context.addInitScript((theme) => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })), theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const video = page.video();
    let caseResult: Record<string, unknown> | undefined;
    const errors: string[] = [], moveActions: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url), path = url.pathname;
      if (path === "/api/machines") return Response.json({ machines: publicMachines(machines()) });
      if (path === "/api/session") return Response.json({ snapshot: publicMachines(machines())[0]!.snapshot });
      if (path === "/api/flock") return handleGraphRequest(request, flow.graphRegistry, machines());
      if (path === "/api/session-moves") {
        if (request.method === "POST") moveActions.push((await request.clone().json()).action);
        return flow.api(request);
      }
      const prefix = "/herdr-web-ui/demo/app/";
      if (!path.startsWith(prefix)) return new Response("not found", { status: 404 });
      const file = decodeURIComponent(path.slice(prefix.length)) || "index.html";
      if (file.includes("\\") || file.split("/").includes("..")) return new Response("bad path", { status: 400 });
      if (file === "index.html") return new Response(html, { headers: { "content-type": "text/html" } });
      const body = Bun.file(join(app, file)); return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
    } });
    let stage = "initial graph";
    try {
      await page.goto(`${server.url.origin}/herdr-web-ui/demo/app/?page=graph&machine=owned-source&pane=owned%3Ap0`);
      const node = () => page.locator(`[data-graph-node=${JSON.stringify(selectedTabId)}]`);
      await node().waitFor(); await inspect(page, selectedTabId, mobile);
      await page.locator(".graph-edge-delegation").waitFor({ state: "attached" });
      assert.equal(await page.locator(".graph-edge-communication").count(), 1);
      assert.equal(flow.graphRegistry.read().observations?.length, 3, "the Graph handler imports the receipt fixtures through the production store");
      assert.ok((flow.graphRegistry.read().herdr_associations ?? []).some((item) => item.endpoint.agent_instance_id === parent.agent_instance_id && item.native_session_id === sourceExecution.native_session_id), "fresh source proof associates Herdr occupancy with the logical session");

      stage = "Graph runtime targets";
      const workerId = tabId("owned-source", "worker-tab");
      await inspect(page, workerId, mobile);
      const openWorkspace = page.getByRole("button", { name: "Open in Workspace", exact: true });
      assert.equal(await openWorkspace.isDisabled(), false, "Graph can open an exactly proven Herdr-only agent");
      await openWorkspace.click();
      await page.waitForURL((url) => url.searchParams.get("machine") === "owned-source" && url.searchParams.get("pane") === worker.pane_id && !url.searchParams.has("page"));
      await openGraph(page);
      await inspect(page, workerId, mobile);
      workerOccupancy = "fixture-worker-replacement";
      await page.locator(".graph-selection-hint").filter({ hasText: "unavailable" }).waitFor();
      assert.equal(await openWorkspace.count(), 0, "a historic relationship cannot open the replacement occupant");
      assert.equal(page.url().includes("page=graph"), true);
      workerOccupancy = worker.agent_instance_id;
      await page.waitForFunction(() => document.querySelector<HTMLButtonElement>(".graph-details button.btn-primary")?.disabled === false);
      await inspect(page, selectedTabId, mobile);
      const steady = await page.evaluate(async (id) => {
        const selected = document.querySelector(`[data-graph-node=${CSS.escape(id)}]`)!, svg = document.querySelector(".graph-surface")!, group = svg.querySelector(":scope > g")!;
        const state = (window as unknown as { graphProof: { reads: number } }).graphProof;
        const reads = state.reads, transform = group.getAttribute("transform"), nodeTransform = selected.getAttribute("transform");
        const began = performance.now(); let frames = 0, changes = 0;
        await new Promise<void>((resolve, reject) => {
          const frame = () => {
            frames++;
            if (document.querySelector(".graph-surface") !== svg || document.querySelector(`[data-graph-node=${CSS.escape(id)}]`) !== selected || group.getAttribute("transform") !== transform || selected.getAttribute("transform") !== nodeTransform) changes++;
            if (state.reads >= reads + 3) resolve();
            else if (performance.now() - began > 15000) reject(new Error("Graph did not perform three scheduled registry reads"));
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        return { frames, changes, reads: state.reads - reads };
      }, selectedTabId);
      assert.ok(steady.frames > 10); assert.equal(steady.changes, 0, "routine source reads do not remount or move the selected graph");
      assert.equal(flow.graphRegistry.read().observations?.length, 3, "polling does not create another receipt");

      stage = "owned backend move";
      const viewportBeforeMove = await page.locator(".graph-surface > g").getAttribute("transform");
      const mutation = async (body: object) => {
        const response = await page.request.post(server.url.origin + "/api/session-moves", { headers: { "x-herdr-machine": "1" }, data: body });
        assert.ok(response.ok()); return response.json();
      };
      let operation = await mutation({ action: "preview", request: flow.request });
      await flow.exit();
      operation = await mutation({ action: "preview", request: flow.request, id: operation.record.id });
      flow.failLaunch();
      await mutation({ action: "run", id: operation.record.id, fingerprint: operation.record.plan.fingerprint });
      const waitForMove = (phase: string) => page.evaluate(async (phase) => {
        const began = performance.now();
        while (performance.now() - began < 30000) {
          const value = await (await (window as unknown as { graphNetwork: typeof fetch }).graphNetwork("/api/session-moves")).json();
          if (value.moves.some((state: { running: boolean; record: { phase: string } }) => !state.running && state.record.phase === phase)) return;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        throw new Error(`Owned migration did not reach ${phase}`);
      }, phase);
      await waitForMove("launching");
      assert.equal(flow.graphRegistry.read().sessions[0]!.current_execution_id, sourceExecution.id, "an uncertain launch does not rebind the logical session");
      await mutation({ action: "run", id: operation.record.id, fingerprint: operation.record.plan.fingerprint });
      await waitForMove("complete");
      assert.deepEqual(flow.counts(), { creates: 1, launches: 1 });
      assert.equal(flow.graphRegistry.read().executions.length, 2);
      assert.equal(flow.graphRegistry.read().sessions[0]!.name, session.name);
      assert.equal(flow.graphRegistry.read().sessions[0]!.work_id, session.work_id);
      const work = flow.verifyWork();
      assert.equal(work.committed, "committed\n"); assert.equal(work.staged, "staged\n"); assert.equal(work.working, "working\n"); assert.equal(work.selected, "selected work\n");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();

      stage = "Graph after move";
      await openGraph(page);
      await page.locator(".graph-selection-hint").filter({ hasText: "unavailable" }).waitFor();
      assert.equal(await openWorkspace.count(), 0, "the old tab occupant cannot redirect after a move");
      selectedTabId = tabId("owned-destination");
      await node().waitFor(); await inspect(page, selectedTabId, mobile);
      assert.equal(await page.locator(".graph-surface > g").getAttribute("transform"), viewportBeforeMove, "an intentional topology change preserves the viewport");
      assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".graph-edge-delegation").count(), 1);
      assert.equal(await page.locator(".graph-edge-communication").count(), 1);
      assert.equal(flow.graphRegistry.read().observations?.length, 3, "historic relationships survive source exit and transfer without duplication");
      const details = page.getByRole("button", { name: "Details and help", exact: true });
      if (mobile && await details.getAttribute("aria-expanded") === "false") await details.click();
      await page.locator(".graph-relations li").filter({ hasText: "2 recorded events" }).filter({ hasText: "Herdr" }).waitFor();
      await page.waitForFunction(() => document.querySelector<HTMLButtonElement>(".graph-details button.btn-primary")?.disabled === false, undefined, { timeout: 20000 });
      await openWorkspace.click();
      await page.waitForURL((url) => url.searchParams.get("machine") === "owned-destination" && url.searchParams.get("pane") === "owned:p0" && !url.searchParams.has("page"));
      await openGraph(page); await node().waitFor();
      assert.equal(await node().getAttribute("aria-pressed"), "true");
      assert.ok(await node().getAttribute("transform"));
      if (mobile && await details.getAttribute("aria-expanded") === "false") await details.click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "the integrated graph has no horizontal overflow");
      const controls = await page.evaluate(() => (window as unknown as { graphProof: { controls: string[] } }).graphProof.controls);
      assert.deepEqual(controls, [], "view changes, observations and transfer verification do not focus or type in a pane");
      assert.deepEqual(errors, []); assert.ok(moveActions.includes("preview") && moveActions.filter((action) => action === "run").length === 2);
      if (evidence) {
        mkdirSync(join(evidence, "graph-integration"), { recursive: true });
        await page.screenshot({ path: join(evidence, "graph-integration", `${width}-${theme}-after-move.png`) });
      }
      caseResult = { width, theme, steady, move: flow.counts(), receipts: flow.graphRegistry.read().observations?.length, pageErrors: errors };
      results.push(caseResult);
      console.log(`PASS integrated Graph + owned Move API ${width} ${theme}: real HTTP/Git transfer, fixture Herdr/native receipts, preserved logical identity and links`);
    } catch (error) {
      console.error("Integrated Graph proof failed", { width, theme, stage, url: page.url(), errors }, await page.locator("body").innerText());
      throw error;
    } finally {
      await context.close(); server.stop(true); await flow.close();
      if (caseResult && video) caseResult.video = await video.path();
    }
  }
  if (evidence) {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    mkdirSync(join(evidence, "graph-integration"), { recursive: true });
    writeFileSync(join(evidence, "graph-integration", "results.json"), JSON.stringify({ sha, diffSha256: createHash("sha256").update(diff).digest("hex"), driverSha256: createHash("sha256").update(readFileSync(import.meta.path)).digest("hex"), source: "real integrated Ovis App, Graph store and Move routes/coordinator/nodes, two loopback endpoints and filesystem transfer", fixtures: ["Herdr occupancy/operation receipts", "native Codex history/ownership/authentication", "roster transport"], nativeHerdrProducer: false, userSessions: 0, results }, null, 2));
  }
} finally { await browser?.close(); rmSync(root, { recursive: true, force: true }); }
