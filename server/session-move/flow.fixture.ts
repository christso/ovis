import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Machine } from "../../shared/machines.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import type { MachineManager } from "../machines.ts";
import { FlockStore } from "../flock.ts";
import { jsonResponse } from "../http.ts";
import { MoveCoordinator } from "./coordinator.ts";
import { MoveNode, type MoveNodeRuntime, type NodeNative } from "./node.ts";
import { handleMoveNode, handleSessionMoves } from "./routes.ts";
import { fixtureHistoryIndex } from "./history-index.fixture.ts";
import { holdQuiescentCodex } from "./quiescence.ts";

export const FIXTURE_THREAD = "019a5a00-0000-7000-8000-000000000001";
export interface FlowDriver {
  native(home: string, destination: boolean): Promise<NodeNative>;
  start(home: string, cwd: string): Promise<void>;
  exit(): Promise<void>;
  close(): Promise<void>;
}
/** Two actual loopback node endpoints and real filesystem transfer; Herdr identity/launch is explicitly a fixture. */
export async function moveFlowFixture(driver?: FlowDriver, options: { segmented?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ovis-move-flow-"));
  const source = join(root, "source"), target = join(root, "destination"), home = join(root, "source-home"), targetHome = join(root, "destination-home"), state = join(root, "manager");
  for (const path of [source, home, targetHome, state, join(root, "source-state"), join(root, "target-state")]) mkdirSync(path);
  const git = (cwd: string, ...args: string[]) => {
    const result = Bun.spawnSync(["git", "-c", "user.name=Owned fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error("owned git fixture failed"); return result.stdout.toString();
  };
  git(source, "init", "--template="); writeFileSync(join(source, "work.txt"), "committed\n"); git(source, "add", "."); git(source, "commit", "-m", "Owned transfer fixture");
  writeFileSync(join(source, "work.txt"), "staged\n"); git(source, "add", "work.txt"); writeFileSync(join(source, "work.txt"), "working\n"); writeFileSync(join(source, "selected.txt"), "selected work\n"); writeFileSync(join(source, "excluded.txt"), "source only\n");
  let rollout = `sessions/2026/11/07/rollout-2026-11-07T01-00-00-${FIXTURE_THREAD}.jsonl`;
  mkdirSync(join(home, "sessions/2026/11/07"), { recursive: true });
  const metadata = { timestamp: "2026-11-07T01:00:00Z", ordinal: 0, type: "session_meta", payload: { id: FIXTURE_THREAD, session_id: FIXTURE_THREAD, cwd: source, timestamp: "2026-11-07T01:00:00Z", originator: "codex_cli_rs", cli_version: "0.166.0", source: "cli", model_provider: "openai", history_mode: "paginated" } };
  const messages = [metadata,
    { timestamp: "2026-11-07T01:00:01Z", ordinal: 1, type: "event_msg", payload: { type: "task_started", turn_id: "019a5a00-0000-7000-8000-000000000099", model_context_window: 10000 } },
    { timestamp: "2026-11-07T01:00:02Z", ordinal: 2, type: "event_msg", payload: { type: "item_completed", thread_id: FIXTURE_THREAD, turn_id: "019a5a00-0000-7000-8000-000000000099", item: { type: "UserMessage", id: "owned-user", content: [{ type: "text", text: "Preserve this owned conversation and dirty work", text_elements: [] }] }, started_at_ms: 1, completed_at_ms: 1 } },
    { timestamp: "2026-11-07T01:00:03Z", ordinal: 3, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Preserve this owned conversation and dirty work" }] } },
    { timestamp: "2026-11-07T01:00:04Z", ordinal: 4, type: "event_msg", payload: { type: "item_completed", thread_id: FIXTURE_THREAD, turn_id: "019a5a00-0000-7000-8000-000000000099", item: { type: "AgentMessage", id: "owned-answer", content: [{ type: "Text", text: "Owned conversation retained" }], phase: "final_answer" }, started_at_ms: 1, completed_at_ms: 1 } },
    { timestamp: "2026-11-07T01:00:05Z", ordinal: 5, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Owned conversation retained" }] } },
    { timestamp: "2026-11-07T01:00:06Z", ordinal: 6, type: "event_msg", payload: { type: "task_complete", turn_id: "019a5a00-0000-7000-8000-000000000099", last_agent_message: "Owned conversation retained" } }];
  writeFileSync(join(home, rollout), messages.map((item) => JSON.stringify(item) + "\n").join(""));
  if (options.segmented) {
    const prefix = readFileSync(join(home, rollout));
    fixtureHistoryIndex(home, FIXTURE_THREAD, prefix.length, 7);
    rollout = `sessions/2026/11/07/rollout-2026-11-07T01-00-01-${FIXTURE_THREAD}_019a5a00-0000-7000-8000-000000000002.jsonl`;
    writeFileSync(join(home, rollout), JSON.stringify({ ...metadata, ordinal: 7, payload: { ...metadata.payload, history_base: { thread_id: FIXTURE_THREAD, end_ordinal_exclusive: 7, end_byte_offset: prefix.length } } }) + "\n");
  }
  const sourceLifetime = randomUUID(), destinationLifetime = randomUUID();
  let sourceExited = false, launched = false, creates = 0, launches = 0, dropChunk = false, dropLaunch = false;
  const view = (destination: boolean): SessionSnapshot => ({ herdr_lifetime: destination ? destinationLifetime : sourceLifetime, flock_bindings: (destination ? launched : !sourceExited) ? [{ pane_id: "owned:p0", terminal_id: destination ? "owned-terminal-destination" : "owned-terminal-source", agent: "codex", native_session_id: FIXTURE_THREAD }] : [], workspaces: [{ workspace_id: "owned-workspace", label: "Owned fixture" }], tabs: [], agents: [], panes: [{ pane_id: "owned:p0", terminal_id: destination ? "owned-terminal-destination" : "owned-terminal-source", workspace_id: "owned-workspace", cwd: destination ? target : source, agent: destination ? launched ? "codex" : null : sourceExited ? null : "codex", agent_status: "idle", agent_session: { agent: "codex", kind: "id", value: FIXTURE_THREAD } }] } as unknown as SessionSnapshot);
  const native = (destination: boolean): NodeNative => ({ async call(method) {
    if (method === "thread/read") return { thread: { id: FIXTURE_THREAD, sessionId: FIXTURE_THREAD, cwd: destination ? target : source, path: join(destination ? targetHome : home, rollout), status: { type: "idle" } } };
    return { data: method === "thread/turns/list" ? [{ id: "owned-turn", status: "completed" }] : [{ id: "owned-user", text: "Preserve this owned conversation and dirty work" }, { id: "owned-answer", text: "Owned conversation retained" }], nextCursor: null };
  }, async close() {} });
  const lock = driver ? null : holdQuiescentCodex(home, FIXTURE_THREAD);
  const runtime = (destination: boolean): MoveNodeRuntime => ({
    async capabilities() { return { version: "0.166.0", platform: "linux", native_resume: true, authenticated: true, home: destination ? targetHome : home }; },
    async observe(pane_id, thread_id, lifetime) { if (destination || sourceExited || thread_id !== FIXTURE_THREAD || lifetime !== sourceLifetime) throw new Error("unproven owned source"); return { home, rollout, cwd: source, pane_id, thread_id, lifetime }; },
    async native(named) { if (destination && options.segmented && !existsSync(join(targetHome, "thread_history_1.sqlite"))) fixtureHistoryIndex(targetHome, "", 0, 0); return driver ? driver.native(named, destination) : native(destination); },
    async create() { creates++; return { pane_id: "owned:p0", lifetime: destinationLifetime }; },
    async find() { return creates ? { pane_id: "owned:p0", lifetime: destinationLifetime } : null; },
    async start() { launches++; if (driver) await driver.start(targetHome, target); launched = true; },
    async paneSession(_pane, thread, lifetime) { return launched && thread === FIXTURE_THREAD && lifetime === destinationLifetime; },
  });
  let sourceNode = new MoveNode(join(root, "source-state"), runtime(false)), destinationNode = new MoveNode(join(root, "target-state"), runtime(true));
  const sourceToken = randomUUID(), targetToken = randomUUID();
  const serve = (destination: boolean, node: () => MoveNode, token: string) => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/api/session") return jsonResponse({ snapshot: view(destination) });
    const copy = request.clone(); const result = await handleMoveNode(request, node(), request.headers.get("authorization") === `Bearer ${token}`);
    const sent = await copy.json() as { action: string };
    if (destination && (dropChunk && sent.action === "write-chunk" || dropLaunch && sent.action === "launch")) { dropChunk = false; dropLaunch = false; return new Response("owned simulated disconnect", { status: 503 }); }
    return result;
  } });
  const sourceServer = serve(false, () => sourceNode, sourceToken), targetServer = serve(true, () => destinationNode, targetToken);
  const machines = (): Machine[] => [
    { id: "owned-source", kind: "ssh", name: "Owned source", enabled: true, state: "connected", error: null, snapshot: view(false) },
    { id: "owned-destination", kind: "ssh", name: "Owned destination", enabled: true, state: "connected", error: null, snapshot: view(true) },
  ];
  const endpoints = new Map([["owned-source", { url: sourceServer.url.origin, token: sourceToken }], ["owned-destination", { url: targetServer.url.origin, token: targetToken }]]);
  const manager = { list: machines, endpoint: (id: string) => endpoints.get(id) } as unknown as MachineManager;
  const flock = new FlockStore(state); let registry = flock.change(0, { type: "create-work", name: "Owned work" }, machines());
  registry = flock.change(registry.revision, { type: "adopt", name: "Owned logical session", work_id: registry.works[0]!.id, binding: { machine_id: "owned-source", herdr_lifetime: sourceLifetime, pane_id: "owned:p0", agent: "codex", native_session_id: FIXTURE_THREAD } }, machines());
  let coordinator = new MoveCoordinator(state, flock, manager, async () => view(false), sourceNode);
  return { root, source, target, home, targetHome, rollout, state, registry, flock, machines, get sourceNode() { return sourceNode; }, get destinationNode() { return destinationNode; }, get coordinator() { return coordinator; },
    request: { session_id: registry.sessions[0]!.id, source_execution_id: registry.executions[0]!.id, destination_machine_id: "owned-destination", destination_checkout: target, untracked_files: ["selected.txt"] },
    async exit() { if (sourceExited) return; if (driver) await driver.exit(); else lock!.release(); sourceExited = true; },
    failChunk() { dropChunk = true; }, failLaunch() { dropLaunch = true; }, counts: () => ({ creates, launches }),
    restartNodes() { sourceNode.close(); destinationNode.close(); sourceNode = new MoveNode(join(root, "source-state"), runtime(false)); destinationNode = new MoveNode(join(root, "target-state"), runtime(true)); },
    restart() { coordinator = new MoveCoordinator(state, flock, manager, async () => view(false), sourceNode); },
    async api(request: Request) { return handleSessionMoves(request, coordinator); },
    verifyWork() { return { committed: git(target, "show", "HEAD:work.txt"), staged: git(target, "show", ":work.txt"), working: readFileSync(join(target, "work.txt"), "utf8"), selected: readFileSync(join(target, "selected.txt"), "utf8"), status: git(target, "status", "--porcelain") }; },
    async close() { sourceNode.close(); destinationNode.close(); sourceServer.stop(true); targetServer.stop(true); lock?.release(); await driver?.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
