/** UI-only planned transfer coverage on fictional PCs. This does not resume or stop an installed agent. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import machinesFixture from "../site/demo/fixtures/machines.json";
import type { Machine } from "../shared/machines.ts";
import type { SessionMoveRecord, SessionMoveRequest } from "../shared/session-move.ts";
import type { SessionMoveState } from "../src/lib/sessionMoves.ts";
import { FlockStore, handleFlockRequest } from "../server/flock.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-move-browser-"));
const app = join(root, "app");
const machines = structuredClone(machinesFixture.machines) as Machine[];
/** Explicit FAKE proofs for fictional browser rosters; no process or native store was examined. */
function fixtureProofs(machine: Machine): void {
  if (machine.snapshot) Object.assign(machine.snapshot, { flock_bindings: machine.snapshot.panes.filter((pane) => pane.agent && pane.agent_session?.kind === "id").map((pane) => ({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent!, native_session_id: pane.agent_session!.value })) });
}
for (const machine of machines) if (machine.snapshot) {
  machine.snapshot.herdr_lifetime = `move-fixture-${machine.id}`;
  for (const pane of machine.snapshot.panes) if (pane.agent) pane.agent_session = { agent: pane.agent, kind: "id", source: "fixture", value: `native-${machine.id}-${pane.pane_id}` };
  fixtureProofs(machine);
}
const target = structuredClone(machines[0]!); target.id = "fixture-target"; target.name = "Fixture destination"; target.kind = "ssh";
const offline = { ...target, id: "fixture-offline", name: "Fixture offline", state: "disconnected" as const };
const source = machines[0]!;
target.snapshot!.herdr_lifetime = "move-fixture-target";
for (const pane of target.snapshot!.panes) if (pane.agent) pane.agent_session = { agent: pane.agent, kind: "id", source: "fixture", value: `native-${target.id}-${pane.pane_id}` };
fixtureProofs(target); fixtureProofs(offline);
machines.push(target, offline);
const targetSnapshot = structuredClone(target.snapshot!);
const chosen = source.snapshot!.panes.find((pane) => pane.agent === "codex")!;
const other = source.snapshot!.panes.find((pane) => pane.agent === "claude")!;
const evidence = process.env["UI_EVIDENCE_DIR"];
let store: FlockStore;
let moves: SessionMoveState[] = [];
let sourceExited = false;
let failHistory = true;
let guards: string[] = [];
let launches = 0;
let runRequests = 0;
let generation = 0;
let statusUnreadable = false;
let pendingPolls = 0;
let exitRefreshNeeded = false;
let previewRevision = 0;
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
const harness = `<script>(() => {
  const fixture = ${JSON.stringify(machines)};
  const demo = window.fetch;
  const network = window.moveFixtureNetwork;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (['/api/flock', '/api/session-moves', '/api/machines', '/api/session'].includes(url.pathname)) return network(input, init);
    return demo(input, init);
  };
  const DemoSource = window.EventSource;
  window.EventSource = function(url, options) {
    if (!String(url).includes('/api/machines/events')) return new DemoSource(url, options);
    const source = new EventTarget(); source.readyState = 1;
    let pending = false, last = '';
    const emit = async () => {
      if (pending || source.readyState !== 1) return;
      pending = true;
      try {
        const answer = await network('/api/machines'); const value = await answer.json(); const data = JSON.stringify({ type: 'machines', machines: value.machines });
        if (source.readyState === 1 && data !== last) { last = data; source.dispatchEvent(new MessageEvent('message', { data })); }
      } finally { pending = false; }
    };
    const timer = setInterval(emit, 500);
    source.close = () => { source.readyState = 2; clearInterval(timer); };
    queueMicrotask(emit);
    return source;
  };
})();</script>`;
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, () => `<script>window.moveFixtureNetwork = window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness}<script type="module"`));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/machines") return respond({ machines });
    if (path === "/api/session") return respond({ snapshot: source.snapshot });
    if (path === "/api/flock") return handleFlockRequest(request, store, machines);
    if (path === "/api/session-moves") {
      if (request.method === "GET") {
        if (pendingPolls > 0 && --pendingPolls === 0) {
          const move = moves.find((state) => state.running);
          if (move) { move.running = false; move.record.phase = "verifying"; move.record.error = "resume_history_mismatch"; }
        }
        return respond(statusUnreadable ? { moves: [{ record: { phase: "future" } }] } : { moves });
      }
      guards.push(request.headers.get("x-herdr-machine") ?? "");
      if (request.headers.get("x-herdr-machine") !== "1") return respond({ error: { code: "invalid_move_request", message: "Fixture mutation guard missing" } }, 403);
      const body = await request.json() as { action: string; request?: SessionMoveRequest; id?: string; fingerprint?: string };
      if (body.action === "preview" && body.request) {
        const input = body.request;
        assert.equal(input.session_id, store.read().sessions[0]!.id);
        assert.equal(input.source_execution_id, store.read().executions[0]!.id);
        assert.equal(input.destination_machine_id, target.id);
        const existing = body.id ? moves.find((move) => move.record.id === body.id) : undefined;
        assert.ok(!body.id || existing, "refresh retains operation identity");
        if (sourceExited) exitRefreshNeeded = false;
        const record: SessionMoveRecord = { id: existing?.record.id ?? `fixture-operation-${++generation}`, phase: "preview", plan: {
          request: input, source_machine_id: source.id, native_thread_id: chosen.agent_session!.value,
          source_checkout: chosen.cwd!, fingerprint: `fixture-preview-${++previewRevision}-${input.untracked_files.join(",")}`,
          files: [{ path: "commits.bundle", bytes: 2048, kind: "tracked" }, { path: "codex/sessions/owned-history.jsonl", bytes: 1024, kind: "codex" }, ...input.untracked_files.map((name) => ({ path: name, bytes: 16, kind: "untracked" as const }))],
          exclusions: ["auth.json", "Ignored fixture files", "Referenced native files retain full discarded tails."],
          untracked_candidates: ["required.png", "scratch.txt"], required_untracked: input.untracked_files.includes("required.png") ? [] : ["required.png"],
        }, snapshot: null, destination: null, error: null };
        const state = { record, running: false };
        moves = [...moves.filter((move) => move.record.id !== record.id), state]; return respond(state);
      }
      const move = moves.find((state) => state.record.id === body.id);
      if (!move) return respond({ error: { code: "move_not_found", message: "Fixture move missing" } }, 404);
      if (body.action === "cancel") { move.record.phase = "cancelled"; return respond(move); }
      assert.equal(body.action, "run"); runRequests++;
      assert.equal(body.fingerprint, move.record.plan.fingerprint, "only a reviewed preview can run");
      if (!sourceExited) { move.record.phase = "quiescing"; move.record.error = "source_not_quiescent"; return respond(move, 202); }
      if (exitRefreshNeeded) { move.record.phase = "quiescing"; move.record.error = "source_changed"; return respond(move, 202); }
      if (move.record.phase === "verifying" && failHistory) { move.record.error = "reconciliation_required"; return respond(move, 202); }
      if (move.record.phase !== "verifying") {
        launches++; move.record.phase = "restoring"; move.running = true; pendingPolls = 3;
        move.record.snapshot = { id: "owned-fixture-snapshot", sha256: "native-history-proof" };
        move.record.error = null;
        return respond(move, 202);
      }
      move.record.snapshot = { id: "owned-fixture-snapshot", sha256: "native-history-proof" };
      if (failHistory) { move.record.error = "resume_history_mismatch"; return respond(move, 202); }
      const binding = { machine_id: target.id, herdr_lifetime: target.snapshot!.herdr_lifetime!, pane_id: chosen.pane_id, agent: "codex", native_session_id: chosen.agent_session!.value };
      const registry = store.read();
      target.snapshot!.panes = target.snapshot!.panes.map((pane) => pane.pane_id === chosen.pane_id ? { ...pane, cwd: move.record.plan.request.destination_checkout, foreground_cwd: move.record.plan.request.destination_checkout, agent_session: { agent: "codex", kind: "id", source: "fixture", value: chosen.agent_session!.value } } : pane);
      fixtureProofs(target);
      store.change(registry.revision, { type: "adopt", binding, session_id: registry.sessions[0]!.id, expected_execution_id: registry.sessions[0]!.current_execution_id }, [
        { ...target, snapshot: { ...target.snapshot!, panes: target.snapshot!.panes.map((pane) => pane.pane_id === chosen.pane_id ? { ...pane, agent_session: { agent: "codex", kind: "id", source: "fixture", value: chosen.agent_session!.value } } : pane) } },
      ]);
      move.record.destination = { ...binding, checkout: move.record.plan.request.destination_checkout, history_sha256: "native-history-proof" };
      move.record.phase = "complete"; move.record.error = null; return respond(move, 202);
    }
    if (!path.startsWith("/herdr-web-ui/demo/app/")) return new Response("not found", { status: 404 });
    const name = decodeURIComponent(path.slice("/herdr-web-ui/demo/app/".length)) || "index.html";
    if (name.split("/").includes("..") || name.includes("\\")) return new Response("bad path", { status: 400 });
    const file = Bun.file(join(app, name));
    return await file.exists() ? new Response(file) : new Response("not found", { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const width of [1280, 390]) {
    store = new FlockStore(join(root, `state-${width}`)); moves = []; target.snapshot = structuredClone(targetSnapshot); sourceExited = false; failHistory = true; guards = []; launches = 0; runRequests = 0; generation = 0; statusUnreadable = false; pendingPolls = 0; exitRefreshNeeded = false; previewRevision = 0;
    for (const pane of [chosen, other]) store.change(store.read().revision, { type: "adopt", name: pane.agent === "codex" ? "Fixture session" : "Unrelated fixture session", binding: { machine_id: source.id, herdr_lifetime: source.snapshot!.herdr_lifetime!, pane_id: pane.pane_id, agent: pane.agent!, native_session_id: pane.agent_session!.value } }, machines);
    const originalSession = structuredClone(store.read().sessions[0]!);
    const originalExecution = structuredClone(store.read().executions[0]!);
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-US", ...(width === 390 ? { isMobile: true, hasTouch: true } : {}), ...(evidence && width === 1280 ? { recordVideo: { dir: join(root, "video"), size: { width: 1280, height: 844 } } } : {}) });
    await context.addInitScript(() => {
      localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" }));
      document.addEventListener("DOMContentLoaded", () => {
        const badge = document.createElement("div"); badge.textContent = "Automated UI fixture · fictional PCs · no native session moved";
        badge.style.cssText = "position:fixed;top:4px;left:4px;z-index:9999;max-width:calc(100vw - 16px);padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text);font:12px sans-serif;pointer-events:none;overflow-wrap:anywhere";
        document.body.appendChild(badge);
      });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    try {
      const url = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/?pane=${encodeURIComponent(chosen.pane_id)}`;
      await page.goto(url);
      const table = page.getByRole("region", { name: "Table", exact: true });
      const openTable = async () => {
        if (width === 390 && await page.getByRole("button", { name: "Open workspace list", exact: true }).isVisible()) {
          if (!(await page.locator("#workspace-drawer").getAttribute("class"))?.includes("is-open")) await page.getByRole("button", { name: "Open workspace list", exact: true }).click();
        }
        await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Table", exact: true }).click();
      };
      await openTable();
      const row = table.locator(`tr[data-row-id="${originalExecution.id}"]`);
      const moveAction = row.getByRole("button", { name: "Move session", exact: true });
      await moveAction.waitFor(); assert.equal(await moveAction.isEnabled(), true);
      assert.equal(await table.locator(`tr[data-row-id="${store.read().executions[1]!.id}"]`).getByRole("button", { name: "Move session", exact: true }).count(), 0, "other agent kinds get no move action");
      const selectionBefore = new URL(page.url()).searchParams.get("pane");
      await moveAction.click();
      let dialog = page.getByRole("dialog", { name: "Move session", exact: true });
      await dialog.getByText("First preview the transfer while Codex is still open. Then finish the turn and exit its native client before moving. Ovis will not stop the client for you.").waitFor();
      assert.equal(await dialog.getByRole("combobox", { name: "Destination PC" }).locator("option").count(), 2, "only connected non-source configured destinations are selectable");
      await dialog.getByRole("combobox", { name: "Destination PC" }).selectOption(target.id);
      await dialog.getByLabel("Destination checkout", { exact: true }).fill("/work/moved-fixture");
      await dialog.getByRole("button", { name: "Preview transfer", exact: true }).click();
      await dialog.getByText("Files to transfer (2)", { exact: true }).waitFor();
      await dialog.getByText("Finish the active turn and exit this session in Codex, then continue here. Ovis will not stop the client for you.").waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Move session", exact: true }).isEnabled(), false, "source exit must be explicitly acknowledged");
      await dialog.getByLabel("I finished the turn and exited this session in Codex.").check();
      assert.equal(await dialog.getByRole("button", { name: "Move session", exact: true }).isEnabled(), false, "a required image must be selected and reviewed even after exit acknowledgement");
      await dialog.getByText("Select required session images and refresh the preview: required.png", { exact: true }).waitFor();
      await dialog.getByLabel("required.png", { exact: true }).check();
      assert.equal(await dialog.getByRole("button", { name: "Move session", exact: true }).isEnabled(), false, "unreviewed file scope cannot run");
      const operationId = moves[0]!.record.id;
      await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
      await dialog.getByText("Files to transfer (3)", { exact: true }).waitFor();
      if (evidence) { mkdirSync(join(evidence, "session-move"), { recursive: true }); await page.screenshot({ path: join(evidence, "session-move", `preview-${width}.png`) }); }
      assert.equal(moves[0]!.record.id, operationId);
      assert.deepEqual(moves[0]!.record.plan.request.untracked_files, ["required.png"]);
      await dialog.getByText("Transfer exclusions", { exact: true }).click();
      await dialog.getByText("auth.json", { exact: true }).waitFor();
      await dialog.getByLabel("I finished the turn and exited this session in Codex.").check();
      await dialog.getByRole("button", { name: "Move session", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "Codex still owns this session" }).waitFor();
      if (evidence) await page.screenshot({ path: join(evidence, "session-move", `source-refused-${width}.png`) });
      assert.equal(launches, 0, "an acknowledged checkbox is not a substitute for native quiescence proof");
      assert.equal(store.read().sessions[0]!.current_execution_id, originalExecution.id);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await row.getByRole("button", { name: "View move", exact: true }).waitFor();
      await page.reload(); await openTable();
      await table.locator(`tr[data-row-id="${originalExecution.id}"]`).getByRole("button", { name: "View move", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Move session", exact: true });
      assert.equal(await dialog.getByLabel("Destination checkout", { exact: true }).inputValue(), "/work/moved-fixture");
      assert.equal(await dialog.getByLabel("required.png", { exact: true }).isChecked(), true);
      sourceExited = true; exitRefreshNeeded = true;
      await dialog.getByLabel("I finished the turn and exited this session in Codex.").check();
      await dialog.getByRole("button", { name: "Retry move", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "The source changed" }).waitFor();
      assert.equal(launches, 0, "native exit metadata changes require a new reviewed preview");
      assert.equal(await dialog.getByRole("button", { name: "Retry move", exact: true }).isEnabled(), false);
      await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
      assert.equal(moves[0]!.record.id, operationId, "post-exit preview refresh retains source observation identity");
      await dialog.getByRole("button", { name: "Move session", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: "Transferring and restoring files" }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Move session", exact: true }).isEnabled(), false, "an active background transfer cannot be started twice");
      assert.equal(await dialog.getByLabel("Destination checkout", { exact: true }).isEnabled(), false);
      if (evidence) await page.screenshot({ path: join(evidence, "session-move", `progress-${width}.png`) });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await table.locator(`tr[data-row-id="${originalExecution.id}"]`).getByRole("button", { name: "View move", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Move session", exact: true });
      await dialog.getByRole("alert").filter({ hasText: "history could not be verified" }).waitFor();
      assert.equal(launches, 1);
      assert.equal(store.read().sessions[0]!.current_execution_id, originalExecution.id, "failed native verification never changes the active binding");
      await dialog.getByRole("button", { name: "Check destination", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "destination launch may already exist" }).waitFor();
      assert.equal(launches, 1, "reconciliation does not launch a duplicate");
      assert.equal(await dialog.getByRole("button", { name: "Cancel move", exact: true }).count(), 0, "an ambiguous native launch cannot be silently discarded");
      if (evidence) { mkdirSync(join(evidence, "session-move"), { recursive: true }); await page.screenshot({ path: join(evidence, "session-move", `recovery-${width}.png`) }); }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "dialog does not widen the viewport");
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true, "keyboard focus stays in the dialog");
      failHistory = false;
      await dialog.getByRole("button", { name: "Check destination", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: "Session moved" }).waitFor();
      if (evidence) await page.screenshot({ path: join(evidence, "session-move", `complete-${width}.png`) });
      assert.equal(store.read().sessions[0]!.id, originalSession.id);
      assert.equal(store.read().sessions[0]!.name, originalSession.name);
      assert.equal(store.read().sessions[0]!.work_id, originalSession.work_id);
      assert.equal(store.read().executions.length, 3);
      assert.equal(launches, 1);
      assert.equal(runRequests, 5);
      assert.equal(new URL(page.url()).searchParams.get("pane"), selectionBefore, "transfer does not change terminal selection");
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLButtonElement>(".session-move-dialog button")).some((button) => button.textContent === "Open moved session" && !button.disabled));
      const lifetime = target.snapshot!.herdr_lifetime!;
      target.snapshot!.herdr_lifetime = "fixture-replaced-destination";
      await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLButtonElement>(".session-move-dialog button")).some((button) => button.textContent === "Open moved session" && button.disabled));
      assert.equal(new URL(page.url()).searchParams.get("pane"), selectionBefore, "a reused destination pane cannot be opened from a stale receipt");
      target.snapshot!.herdr_lifetime = lifetime;
      await dialog.getByRole("button", { name: "Open moved session", exact: true }).click();
      await page.waitForURL((at) => at.searchParams.get("machine") === target.id && at.searchParams.get("pane") === chosen.pane_id);
      await openTable();
      assert.equal(await table.locator(`tr[data-row-id="${originalExecution.id}"]`).getByRole("button", { name: "Move session", exact: true }).count(), 0, "previous executions cannot start another move");
      statusUnreadable = true;
      await page.reload(); await openTable();
      await page.getByRole("alert").filter({ hasText: "Move status is unavailable" }).waitFor();
      assert.equal(await table.getByRole("button", { name: "Move session", exact: true }).isEnabled(), false, "unreadable recovery receipts disable new moves");
      assert.ok(guards.length > 0 && guards.every((value) => value === "1"));
      assert.deepEqual(errors, []);
      console.log(`PASS planned transfer UI ${width}: reviewed file scope, explicit native exit, refusal, reload/reconciliation, preserved identity and explicit terminal selection`);
    } finally {
      const video = page.video(); await context.close();
      if (video && evidence) {
        const output = join(evidence, "session-move", `planned-transfer-fixture-${width}.mp4`);
        mkdirSync(join(evidence, "session-move"), { recursive: true });
        const encoded = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-y", "-i", await video.path(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output]);
        if (encoded.exitCode) throw new Error(`Could not encode owned fixture video: ${encoded.stderr.toString()}`);
        console.log(`Fixture-only MP4: ${output}`);
      }
    }
  }
} finally { await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true }); }
