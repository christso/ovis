import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { graphBinding } from "../shared/graph-registry-inventory.ts";
import type { MachineManager } from "./machines.ts";
import { GraphRegistryStore, handleGraphRequest } from "./graph-registry.ts";
import * as codex from "./codex.ts";
import { snapshotWithoutHiddenTokens } from "./herdr-sidebar.ts";
import { readGraphSource, verifyGraphSnapshot } from "./graph-source.ts";
import type { GraphObservation, HerdrCoordinationEndpoint, HerdrCoordinationPage } from "../shared/graph-registry.ts";
import { codexCoordinationObservations } from "./codex-relationships.ts";
import * as herdrCoordination from "./herdr-coordination.ts";

const roots: string[] = [];
let coordinationReader: ReturnType<typeof spyOn>;
beforeEach(() => { coordinationReader = spyOn(herdrCoordination, "herdrCoordinationSnapshot").mockResolvedValue(undefined); });
const own = "11111111-1111-4111-8111-111111111111", target = "22222222-2222-4222-8222-222222222222";
const observation: GraphObservation = { id: "observed-send", kind: "communication", source_native_session_id: own, target_native_session_id: target, occurred_at: "2026-11-08T00:00:00Z", source: "codex" };
afterEach(() => { coordinationReader.mockRestore(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const snapshot = (native: string): SessionSnapshot => ({ agents: [], layouts: [], protocol: 1, version: "fixture", tabs: [], workspaces: [], herdr_lifetime: "remote-herdr",
  flock_bindings: [{ pane_id: "w1:p1", terminal_id: "terminal", agent: "codex", native_session_id: native }],
  panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "terminal", revision: 0, focused: false, agent: "codex", agent_status: "idle", cwd: "/fixture/repo", agent_session: { agent: "codex", kind: "id", source: "fixture", value: native } }] });
const machine = (): Machine => ({ id: "remote", name: "Remote fixture", kind: "ssh", enabled: true, state: "connected", error: null, snapshot: snapshot("cached-native") });
const local = async (): Promise<SessionSnapshot> => { throw new Error("Remote adoption must not read the local source"); };

it("discards incoming proof metadata for an agent without a verified reader", async () => {
  const source = snapshot("unproven"); source.panes[0]!.agent = "claude";
  source.flock_observations = [observation];
  const verified = await verifyGraphSnapshot(async () => source);
  expect(verified.flock_bindings).toEqual([]);
  expect(verified.flock_observations).toEqual([]);
  expect(source.flock_bindings).toHaveLength(1);
  expect(source.flock_observations).toHaveLength(1);
});

const occupancy: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "terminal", agent_instance_id: "instance", agent: "claude", pane_id: "w1:p1", name: "Coordinator" };
const coordinationPage = (): HerdrCoordinationPage => ({ version: 1, server_id: "server", boot_id: "boot", agents: [occupancy], cursor: null,
  receipts: [{ id: "closed-source-send", kind: "communication", source: occupancy, target: { ...occupancy, terminal_id: "closed-terminal", agent_instance_id: "closed-instance", pane_id: "w2:p1", name: "Closed worker" }, occurred_at: observation.occurred_at }] });

it("preserves the daemon's closed-agent history while discarding injected coordination metadata", async () => {
  const source = snapshot("hint"); source.panes = [];
  source.flock_coordination = { ...coordinationPage(), server_id: "injected" };
  const page = coordinationPage(); page.agents = [];
  coordinationReader.mockResolvedValue(page);
  const result = await verifyGraphSnapshot(async () => source);
  expect(result.flock_coordination?.receipts).toEqual(page.receipts);
  expect(result.flock_coordination?.server_id).toBe("server");
  expect(result.flock_coordination?.agents).toEqual([]);
});

it("drops current occupancy when an agent is replaced during the source read", async () => {
  const source = snapshot("hint"); source.panes[0]!.agent = "claude";
  let reads = 0;
  coordinationReader.mockImplementation(async () => {
    reads += 1;
    return reads === 1 ? coordinationPage() : { ...coordinationPage(), agents: [{ ...occupancy, agent_instance_id: "replacement" }] };
  });
  const result = await verifyGraphSnapshot(async () => source);
  expect(result.flock_coordination?.agents).toEqual([]);
  expect(result.flock_coordination?.receipts).toHaveLength(1);
});

it("drops native proof when the same CLI replaces its occupant without changing pane, terminal or cwd", async () => {
  const source = snapshot("hint");
  const oldEndpoint = { ...occupancy, agent: "codex" };
  let reads = 0;
  coordinationReader.mockImplementation(async () => {
    reads += 1;
    return { ...coordinationPage(), agents: [{ ...oldEndpoint, agent_instance_id: reads === 1 ? "old" : "replacement" }] };
  });
  const nativeReader = spyOn(codex, "codexPaneCoordination").mockResolvedValue({ id: own, observations: [observation], rolloutPath: "/fixture/rollout" });
  try {
    const result = await verifyGraphSnapshot(async () => source);
    expect(result.flock_bindings).toEqual([]);
    expect(result.flock_observations).toEqual([]);
    expect(result.flock_coordination?.agents).toEqual([]);
  } finally { nativeReader.mockRestore(); }
});

it("does not expose a cached occupancy or native proof after the daemon changes", async () => {
  const source = snapshot("hint"); source.flock_coordination = coordinationPage();
  let reads = 0;
  coordinationReader.mockImplementation(async () => {
    reads += 1;
    return reads === 1 ? coordinationPage() : { ...coordinationPage(), boot_id: "replacement", agents: [] };
  });
  const nativeReader = spyOn(codex, "codexPaneCoordination").mockResolvedValue({ id: own, observations: [observation], rolloutPath: "/fixture/rollout" });
  try {
    const result = await verifyGraphSnapshot(async () => source);
    expect(result.flock_coordination).toBeUndefined();
    expect(result.flock_bindings).toEqual([]);
  } finally { nativeReader.mockRestore(); }
});

it("clears cached coordination and native proofs when a manager cannot freshly read a source", async () => {
  const source = machine(); source.snapshot!.flock_coordination = coordinationPage();
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-failed-source-")); roots.push(root);
  const response = await handleGraphRequest(new Request("http://localhost/api/flock?sources=1"), new GraphRegistryStore(root), [source], async () => { throw new Error("fixture unavailable"); });
  const body = await response.json();
  expect(body.sources[0].snapshot.flock_coordination).toBeUndefined();
  expect(body.sources[0].snapshot.flock_bindings).toEqual([]);
  expect(body.sources[0].snapshot.flock_observations).toEqual([]);
});

for (const replacement of ["lifetime", "terminal", "cwd", "agent"] as const) it(`drops native proof if ${replacement} changes while ownership is being read`, async () => {
  const before = snapshot("old-hint"), after = structuredClone(before);
  if (replacement === "lifetime") after.herdr_lifetime = "replacement-herdr";
  if (replacement === "terminal") after.panes[0]!.terminal_id = "replacement-terminal";
  if (replacement === "cwd") after.panes[0]!.cwd = "/fixture/replaced";
  if (replacement === "agent") after.panes[0]!.agent = "claude";
  let changed = false;
  const reader = spyOn(codex, "codexPaneCoordination").mockImplementation(async () => { changed = true; return { id: own, observations: [observation], rolloutPath: "/fixture/rollout.jsonl" }; });
  const source = { ...machine(), kind: "local" as const };
  const manager = { list: () => [source] } as unknown as MachineManager;
  try {
    const sources = await readGraphSource(manager, source.id, async () => changed ? after : before);
    expect(sources[0]!.snapshot!.flock_bindings).toEqual([]);
    expect(sources[0]!.snapshot!.flock_observations).toEqual([]);
  } finally { reader.mockRestore(); }
});

it("transports native receipts with the same proven session and discards incoming observations", async () => {
  const source = snapshot("untrusted-hint");
  source.flock_observations = [{ ...observation, id: "untrusted-snapshot" }];
  const reader = spyOn(codex, "codexPaneCoordination").mockResolvedValue({ id: own, observations: [observation], rolloutPath: "/fixture/rollout.jsonl" });
  try {
    const verified = await verifyGraphSnapshot(async () => source);
    expect(verified.flock_bindings).toEqual([{ pane_id: "w1:p1", terminal_id: "terminal", agent: "codex", native_session_id: own }]);
    expect(verified.flock_observations).toEqual([observation]);
    expect(source.flock_observations[0]!.id).toBe("untrusted-snapshot");
  } finally { reader.mockRestore(); }
});

it("imports a successful native rollout receipt through source verification and the ordinary registry read", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-native-receipt-")); roots.push(root);
  const path = join(root, "rollout.jsonl");
  writeFileSync(path, [
    { type: "session_meta", payload: { id: own, source: "cli" } },
    { timestamp: observation.occurred_at, type: "event_msg", payload: { type: "item_completed", thread_id: own,
      item: { type: "SubAgentActivity", id: observation.id, kind: "interacted", agent_thread_id: target } } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  // Only pane/native ownership is fictional; parsing, snapshot bracketing, manager import and persistence are real.
  const reader = spyOn(codex, "codexPaneCoordination").mockImplementation(async () => ({ id: own, observations: await codexCoordinationObservations(path, own), rolloutPath: path }));
  const source = { ...machine(), kind: "local" as const }, store = new GraphRegistryStore(root);
  const manager = { list: () => [source] } as unknown as MachineManager;
  const get = () => handleGraphRequest(new Request("http://localhost/api/flock?sources=1"), store, [source],
    (id) => readGraphSource(manager, id, async () => source.snapshot!));
  try {
    const response = await get(); expect(response.status).toBe(200);
    expect(store.read().observations).toEqual([{ ...observation, occurred_at: "2026-11-08T00:00:00.000Z", machine_id: source.id }]);
    await get(); expect(store.read().observations).toHaveLength(1);
    expect(new GraphRegistryStore(root).read().observations).toEqual(store.read().observations);
  } finally { reader.mockRestore(); }
});

it("redacts hidden source tokens only at the browser response boundary", async () => {
  const source = machine(); source.snapshot!.panes[0]!.tokens = { private: "hide this value", branch: "shown" };
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-private-")); roots.push(root);
  const response = await handleGraphRequest(new Request("http://localhost/api/flock?sources=1"), new GraphRegistryStore(root), [source], async () => [source],
    (snapshot) => snapshotWithoutHiddenTokens({ rows: [{ name: "private", rules: [{ contains: "hide", hide: true }] }], by_agent: {} }, snapshot));
  const body = await response.json();
  expect(body.sources[0].snapshot.panes[0].tokens).toEqual({ branch: "shown" });
  expect(source.snapshot!.panes[0]!.tokens).toEqual({ private: "hide this value", branch: "shown" });
});

it("adopts fresh remote native identity rather than the manager's cached snapshot", async () => {
  const source = machine(); const fresh = snapshot("current-native"); let authorization: string | null = null;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { expect(new URL(request.url).searchParams.get("flock")).toBe("1"); authorization = request.headers.get("authorization"); return Response.json({ snapshot: fresh }); } });
  const endpoint = { url: `http://127.0.0.1:${server.port}`, token: "fixture-only-token" };
  const manager = { list: () => [source], endpoint: () => endpoint } as unknown as MachineManager;
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-remote-")); roots.push(root);
  try {
    const sources = await readGraphSource(manager, source.id, local);
    const binding = graphBinding({ ...source, snapshot: fresh }, fresh.panes[0]!)!;
    const doc = new GraphRegistryStore(root).change(0, { type: "adopt", name: "Remote work", binding }, sources);
    expect(authorization as string | null).toBe("Bearer fixture-only-token");
    expect(doc.executions[0]!.native_session_id).toBe("current-native");
    expect(source.snapshot!.panes[0]!.agent_session!.value).toBe("cached-native");
  } finally { server.stop(true); }
});

it("keeps an older remote's bare hint unsupported and refuses adoption without changing disk", async () => {
  const source = machine(), fresh = snapshot("another-panes-thread"); delete fresh.flock_bindings;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return Response.json({ snapshot: fresh }); } });
  const endpoint = { url: server.url.origin, token: "fixture-only-token" };
  const manager = { list: () => [source], endpoint: () => endpoint } as unknown as MachineManager;
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-unproven-")); roots.push(root);
  const store = new GraphRegistryStore(root);
  try {
    const sources = await readGraphSource(manager, source.id, local);
    expect(graphBinding(sources[0]!, fresh.panes[0]!)).toBeNull();
    const binding = { machine_id: source.id, herdr_lifetime: fresh.herdr_lifetime!, pane_id: "w1:p1", agent: "codex", native_session_id: "another-panes-thread" };
    expect(() => store.change(0, { type: "adopt", name: "Unproven", binding }, sources)).toThrow();
    expect(store.read().revision).toBe(0);
  } finally { server.stop(true); }
});

it("refuses endpoint replacement while the remote read is pending without appending an execution", async () => {
  const source = machine(); const fresh = snapshot("current-native");
  let endpoint = { url: "", token: "fixture-only-token" };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    endpoint = { ...endpoint };
    return Response.json({ snapshot: fresh });
  } });
  endpoint.url = `http://127.0.0.1:${server.port}`;
  const manager = { list: () => [source], endpoint: () => endpoint } as unknown as MachineManager;
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-remote-")); roots.push(root);
  const store = new GraphRegistryStore(root);
  const binding = graphBinding({ ...source, snapshot: fresh }, fresh.panes[0]!)!;
  try {
    const pending = readGraphSource(manager, source.id, local).then((sources) => store.change(0, { type: "adopt", name: "Do not append", binding }, sources));
    await expect(pending).rejects.toMatchObject({ code: "flock_conflict" });
    expect(store.read().revision).toBe(0);
    expect(store.read().executions).toEqual([]);
  } finally { server.stop(true); }
});
