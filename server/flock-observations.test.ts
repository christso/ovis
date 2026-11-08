import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlockStore, handleFlockRequest } from "./flock.ts";
import { flockCurrentHerdrEndpoint, flockHerdrRelationshipEndpoint, flockHerdrTarget, flockRelationships, flockRowRelationshipIds } from "../shared/flock-relationships.ts";
import { flockInventory, flockTarget } from "../shared/flock-inventory.ts";
import type { HerdrCoordinationEndpoint, HerdrCoordinationPage } from "../shared/flock.ts";
import type { Machine } from "../shared/machines.ts";

const sourceId = "11111111-1111-4111-8111-111111111111", targetId = "22222222-2222-4222-8222-222222222222";
const event = { id: "call-1", kind: "communication" as const, source_native_session_id: sourceId, target_native_session_id: targetId, occurred_at: "2026-11-08T00:00:00Z", source: "codex" as const };
function machine(): Machine { return { id: "local", name: "Local", kind: "local", enabled: true, state: "connected", error: null,
  snapshot: { protocol: 1, version: "fixture", agents: [], layouts: [], workspaces: [], tabs: [], panes: [], focused_workspace_id: null, focused_pane_id: null, herdr_lifetime: "fixture",
    flock_bindings: [{ pane_id: "p", terminal_id: "t", agent: "codex", native_session_id: sourceId }], flock_observations: [event] } }; }

it("imports only proof-backed observations, deduplicates polling and retains links after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-observations-"));
  try {
    const store = new FlockStore(root), source = machine();
    const get = () => handleFlockRequest(new Request("http://localhost/api/flock?sources=1"), store, [source], async () => [source]);
    await get(); const first = store.read();
    expect(first.observations).toHaveLength(1);
    expect(flockRelationships(first)[0]).toMatchObject({ kind: "communication", count: 1, source: { native_session_id: sourceId }, target: { native_session_id: targetId } });
    await get(); expect(store.read()).toEqual(first);
    source.snapshot!.flock_observations!.push({ ...event, id: "call-2", occurred_at: "2026-11-08T00:01:00Z" });
    await get(); expect(flockRelationships(store.read())[0]).toMatchObject({ count: 2, last_at: "2026-11-08T00:01:00Z" });
    expect(new FlockStore(root).read()).toEqual(store.read());
    source.snapshot!.flock_bindings = [];
    source.snapshot!.flock_observations!.push({ ...event, id: "unproven" });
    await get(); expect(store.read().observations).toHaveLength(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("resolves historical native endpoints to stable logical sessions after a machine move", () => {
  const registry = { version: 1 as const, revision: 0, works: [], checkouts: [], sessions: [{ id: "logical", name: "Coordinator", work_id: null, current_execution_id: "new" }], executions: [
    { id: "old", session_id: "logical", checkout_id: null, machine_id: "local", herdr_lifetime: "old", pane_id: "p", agent: "codex", native_session_id: sourceId, created_at: event.occurred_at },
    { id: "new", session_id: "logical", checkout_id: null, machine_id: "remote", herdr_lifetime: "new", pane_id: "p", agent: "codex", native_session_id: sourceId, created_at: event.occurred_at }], observations: [{ ...event, machine_id: "local" }] };
  expect(flockRelationships(registry)[0]?.source).toMatchObject({ id: "session:logical", label: "Coordinator", session_id: "logical" });
  expect(flockRelationships(registry)[0]?.target.session_id).toBeNull();
  registry.sessions.push({ id: "other", name: "Ambiguous", work_id: null, current_execution_id: "ambiguous" });
  registry.executions.push({ ...registry.executions[0]!, id: "ambiguous", session_id: "other", herdr_lifetime: "another-lifetime" });
  expect(flockRelationships(registry)[0]?.source.session_id).toBeNull();
  expect(flockRelationships(registry)[0]?.source.id.startsWith("native:")).toBe(true);
});

it("does not accept browser-created links or copy message content from a source receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-observations-"));
  try {
    const store = new FlockStore(root), source = machine();
    Object.assign(source.snapshot!.flock_observations![0]!, { message: "private fixture message" });
    store.observe([source]);
    const before = readFileSync(join(root, "flock.json"), "utf8");
    expect(before).not.toContain("private fixture message");
    const response = await handleFlockRequest(new Request("http://localhost/api/flock", { method: "POST", headers: { origin: "http://localhost", "x-herdr-machine": "1" }, body: JSON.stringify({ revision: store.read().revision, command: { type: "create-link", ...event } }) }), store, [source]);
    expect(response.status).toBe(400);
    expect(readFileSync(join(root, "flock.json"), "utf8")).toBe(before);
    const corrupt = { ...store.read(), observations: [{ ...event, machine_id: "local", kind: "future-kind" }] };
    writeFileSync(join(root, "flock.json"), JSON.stringify(corrupt));
    expect(() => store.observe([source])).toThrow("preserved");
    expect(JSON.parse(readFileSync(join(root, "flock.json"), "utf8"))).toEqual(corrupt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("records a native receipt once when the same rollout is replayed on another machine", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-observations-"));
  try {
    const store = new FlockStore(root), old = machine(), destination = machine(); destination.id = "destination";
    store.observe([old]); const revision = store.read().revision;
    store.observe([destination]);
    expect(store.read().observations).toHaveLength(1);
    expect(store.read().observations![0]!.machine_id).toBe(old.id);
    expect(store.read().revision).toBe(revision);
    const oldData = { ...store.read(), observations: [{ ...event, machine_id: "local" }, { ...event, machine_id: "destination" }] };
    expect(flockRelationships(oldData).reduce((count, relation) => count + relation.count, 0)).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("retains daemon-owned Herdr relationships after both agents close without native-ID guesses", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-herdr-observations-"));
  const endpoint = (id: string, agent: string) => ({ server_id: "server", boot_id: "boot", terminal_id: `terminal-${id}`, agent_instance_id: id, agent, pane_id: `w1:p${id}`, name: id });
  const receipt = { id: "operation", kind: "communication", source: endpoint("1", "claude"), target: endpoint("2", "codex"), occurred_at: event.occurred_at };
  const source = machine();
  // The bridge's coordination inventory is independent of live native ownership and panes.
  Object.assign(source.snapshot!, { flock_coordination: { version: 1, server_id: "server", boot_id: "boot", agents: [], receipts: [receipt], cursor: null } });
  try {
    const store = new FlockStore(root);
    store.observe([source]);
    const relation = flockRelationships(store.read()).find((item) => item.source.id.startsWith("herdr:"));
    expect(relation).toMatchObject({ kind: "communication", count: 1, source: { label: "1", agent: "claude" }, target: { label: "2", agent: "codex" } });
    expect(relation?.source.id.startsWith("herdr:")).toBe(true);
    store.observe([source]);
    expect(flockRelationships(new FlockStore(root).read())).toHaveLength(2);
    expect(flockRelationships(store.read()).find((item) => item.source.id.startsWith("herdr:"))?.count).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("associates a current Herdr occupancy only with separately proven native ownership and retains it through a move", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-herdr-native-alias-"));
  const endpoint: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "t", agent_instance_id: "source-instance", agent: "codex", pane_id: "p", name: "Coordinator" };
  const target = { ...endpoint, terminal_id: "other-terminal", agent_instance_id: "worker-instance", agent: "claude", pane_id: "other-pane", name: "Worker" };
  const source = machine();
  source.snapshot!.panes = [{ pane_id: "p", terminal_id: "t", agent: "codex", workspace_id: "w1", tab_id: "w1:t1", focused: false, revision: 0, agent_status: "idle", cwd: "/fixture" }];
  source.snapshot!.flock_coordination = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [{ id: "herdr-send", kind: "communication", source: endpoint, target, occurred_at: event.occurred_at }], cursor: null };
  try {
    const store = new FlockStore(root);
    let registry = store.observe([source]);
    const row = flockInventory(registry, [source])[0]!;
    expect(flockRowRelationshipIds(registry, row)).toContain(flockHerdrRelationshipEndpoint(registry, endpoint).id);
    registry = store.change(registry.revision, { type: "adopt", name: "Stable coordinator", binding: row.binding! }, [source]);
    const logical = registry.sessions[0]!.id;
    expect(flockHerdrRelationshipEndpoint(registry, endpoint).id).toBe(`session:${logical}`);
    const destination = structuredClone(source); destination.id = "destination";
    delete destination.snapshot!.flock_coordination;
    const binding = { ...row.binding!, machine_id: destination.id };
    registry = store.change(registry.revision, { type: "adopt", session_id: logical, binding }, [destination]);
    source.snapshot!.panes = []; source.snapshot!.flock_coordination.agents = [];
    store.observe([source]);
    expect(flockHerdrRelationshipEndpoint(new FlockStore(root).read(), endpoint).id).toBe(`session:${logical}`);
    // Conflicting native claims do not silently retarget a historical occupancy.
    registry = store.read();
    registry.herdr_associations!.push({ endpoint, machine_id: "local", native_session_id: targetId });
    expect(flockHerdrRelationshipEndpoint(registry, endpoint).id.startsWith("herdr:")).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("targets only one exact current Herdr occupancy and never promotes it to native adoption", () => {
  const source = machine();
  const endpoint: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "t", agent_instance_id: "instance", agent: "claude", pane_id: "p", name: "Worker" };
  source.snapshot!.panes = [{ pane_id: "p", terminal_id: "t", agent: "claude", workspace_id: "w1", tab_id: "w1:t1", focused: false, revision: 0, agent_status: "idle" }];
  source.snapshot!.flock_bindings = [];
  const page: HerdrCoordinationPage = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
  source.snapshot!.flock_coordination = page;
  expect(flockCurrentHerdrEndpoint(source, source.snapshot!.panes[0]!)).toEqual(endpoint);
  expect(flockHerdrTarget(endpoint, [source])).toEqual({ machine_id: "local", pane_id: "p" });
  const registry = { version: 1 as const, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
  const row = flockInventory(registry, [source])[0]!;
  expect(row.binding).toBeNull();
  expect(row.availability).toBe("unsupported");
  expect(flockTarget(row)).toEqual({ machine_id: "local", pane_id: "p" });
  expect(flockRowRelationshipIds(registry, row)[0]?.startsWith("herdr:")).toBe(true);
  page.agents = [{ ...endpoint, agent_instance_id: "replacement" }];
  expect(flockHerdrTarget(endpoint, [source])).toBeNull();
  page.agents = [endpoint];
  const duplicate = structuredClone(source); duplicate.id = "duplicate";
  expect(flockHerdrTarget(endpoint, [source, duplicate])).toBeNull();
  source.state = "disconnected";
  expect(flockHerdrTarget(endpoint, [source])).toBeNull();
});
