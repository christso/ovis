import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlockStore, handleFlockRequest } from "./flock.ts";
import { flockRelationships } from "../shared/flock-relationships.ts";
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
