import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { flockBinding } from "../shared/flock-inventory.ts";
import type { MachineManager } from "./machines.ts";
import { FlockStore } from "./flock.ts";
import { readFlockSource } from "./flock-source.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const snapshot = (native: string): SessionSnapshot => ({ agents: [], layouts: [], protocol: 1, version: "fixture", tabs: [], workspaces: [], herdr_lifetime: "remote-herdr",
  panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "terminal", revision: 0, focused: false, agent: "codex", agent_status: "idle", cwd: "/fixture/repo", agent_session: { agent: "codex", kind: "id", source: "fixture", value: native } }] });
const machine = (): Machine => ({ id: "remote", name: "Remote fixture", kind: "ssh", enabled: true, state: "connected", error: null, snapshot: snapshot("cached-native") });
const local = async (): Promise<SessionSnapshot> => { throw new Error("Remote adoption must not read the local source"); };

it("adopts fresh remote native identity rather than the manager's cached snapshot", async () => {
  const source = machine(); const fresh = snapshot("current-native"); let authorization: string | null = null;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { authorization = request.headers.get("authorization"); return Response.json({ snapshot: fresh }); } });
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
