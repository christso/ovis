import { afterEach, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { flockBinding } from "../shared/flock-inventory.ts";
import type { MachineManager } from "./machines.ts";
import { FlockStore, handleFlockRequest } from "./flock.ts";
import * as codex from "./codex.ts";
import { snapshotWithoutHiddenTokens } from "./herdr-sidebar.ts";
import { readFlockSource, verifyFlockSnapshot } from "./flock-source.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const snapshot = (native: string): SessionSnapshot => ({ agents: [], layouts: [], protocol: 1, version: "fixture", tabs: [], workspaces: [], herdr_lifetime: "remote-herdr",
  flock_bindings: [{ pane_id: "w1:p1", terminal_id: "terminal", agent: "codex", native_session_id: native }],
  panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "terminal", revision: 0, focused: false, agent: "codex", agent_status: "idle", cwd: "/fixture/repo", agent_session: { agent: "codex", kind: "id", source: "fixture", value: native } }] });
const machine = (): Machine => ({ id: "remote", name: "Remote fixture", kind: "ssh", enabled: true, state: "connected", error: null, snapshot: snapshot("cached-native") });
const local = async (): Promise<SessionSnapshot> => { throw new Error("Remote adoption must not read the local source"); };

it("discards incoming proof metadata for an agent without a verified reader", async () => {
  const source = snapshot("unproven"); source.panes[0]!.agent = "claude";
  expect((await verifyFlockSnapshot(async () => source)).flock_bindings).toEqual([]);
  expect(source.flock_bindings).toHaveLength(1);
});

for (const replacement of ["lifetime", "terminal", "cwd", "agent"] as const) it(`drops native proof if ${replacement} changes while ownership is being read`, async () => {
  const before = snapshot("old-hint"), after = structuredClone(before);
  if (replacement === "lifetime") after.herdr_lifetime = "replacement-herdr";
  if (replacement === "terminal") after.panes[0]!.terminal_id = "replacement-terminal";
  if (replacement === "cwd") after.panes[0]!.cwd = "/fixture/replaced";
  if (replacement === "agent") after.panes[0]!.agent = "claude";
  let changed = false;
  const reader = spyOn(codex, "codexPaneSession").mockImplementation(async () => { changed = true; return "replacement-native"; });
  const source = { ...machine(), kind: "local" as const };
  const manager = { list: () => [source] } as unknown as MachineManager;
  try {
    const sources = await readFlockSource(manager, source.id, async () => changed ? after : before);
    expect(sources[0]!.snapshot!.flock_bindings).toEqual([]);
  } finally { reader.mockRestore(); }
});

it("redacts hidden source tokens only at the browser response boundary", async () => {
  const source = machine(); source.snapshot!.panes[0]!.tokens = { private: "hide this value", branch: "shown" };
  const root = mkdtempSync(join(tmpdir(), "ovis-flock-private-")); roots.push(root);
  const response = await handleFlockRequest(new Request("http://localhost/api/flock?sources=1"), new FlockStore(root), [source], async () => [source],
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
  const root = mkdtempSync(join(tmpdir(), "ovis-flock-remote-")); roots.push(root);
  try {
    const sources = await readFlockSource(manager, source.id, local);
    const binding = flockBinding({ ...source, snapshot: fresh }, fresh.panes[0]!)!;
    const doc = new FlockStore(root).change(0, { type: "adopt", name: "Remote work", binding }, sources);
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
  const root = mkdtempSync(join(tmpdir(), "ovis-flock-unproven-")); roots.push(root);
  const store = new FlockStore(root);
  try {
    const sources = await readFlockSource(manager, source.id, local);
    expect(flockBinding(sources[0]!, fresh.panes[0]!)).toBeNull();
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
  const root = mkdtempSync(join(tmpdir(), "ovis-flock-remote-")); roots.push(root);
  const store = new FlockStore(root);
  const binding = flockBinding({ ...source, snapshot: fresh }, fresh.panes[0]!)!;
  try {
    const pending = readFlockSource(manager, source.id, local).then((sources) => store.change(0, { type: "adopt", name: "Do not append", binding }, sources));
    await expect(pending).rejects.toMatchObject({ code: "flock_conflict" });
    expect(store.read().revision).toBe(0);
    expect(store.read().executions).toEqual([]);
  } finally { server.stop(true); }
});
