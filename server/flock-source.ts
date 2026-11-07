import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import type { MachineManager } from "./machines.ts";
import { codexPaneSession } from "./codex.ts";
import { FlockError } from "./flock.ts";
import { discard, readCappedJson, REMOTE_LIMITS } from "./remote-json.ts";

/** Proof is bridge-owned and ephemeral. Unsupported readers never promote a raw native-session hint. */
export async function verifyFlockSnapshot(readSnapshot: () => Promise<SessionSnapshot>, codexHome?: string): Promise<SessionSnapshot> {
  const snapshot = await readSnapshot();
  const flock_bindings: NonNullable<SessionSnapshot["flock_bindings"]> = [];
  if (snapshot.herdr_lifetime) for (const pane of snapshot.panes) {
    if (pane.agent !== "codex" || !pane.cwd || pane.restore_error) continue;
    try {
      const id = await codexPaneSession(pane.pane_id, pane.cwd, codexHome, snapshot.panes);
      if (id) flock_bindings.push({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent, native_session_id: id });
    } catch { /* uncertain ownership remains visible but unsupported */ }
  }
  const current = await readSnapshot();
  return { ...current, flock_bindings: current.herdr_lifetime !== snapshot.herdr_lifetime ? [] : flock_bindings.filter((proof) => {
    const before = snapshot.panes.find((pane) => pane.pane_id === proof.pane_id);
    const after = current.panes.find((pane) => pane.pane_id === proof.pane_id);
    return after && after.terminal_id === proof.terminal_id && after.agent === proof.agent && !after.restore_error && after.cwd === before?.cwd;
  }) };
}

/** Adoption checks fresh native ownership as well as the pane incarnation. Older peers fail closed. */
export async function readFlockSource(manager: MachineManager | null, id: string, localSnapshot: () => Promise<SessionSnapshot>, codexHome?: string): Promise<readonly Machine[]> {
  const machine = manager?.list().find((item) => item.id === id);
  if (!machine || machine.state !== "connected") throw new FlockError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  if (machine.kind === "local") return [{ ...machine, snapshot: await verifyFlockSnapshot(localSnapshot, codexHome) }];
  const endpoint = manager!.endpoint(id);
  if (!endpoint) throw new FlockError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  const response = await fetch(`${endpoint.url}/api/session?flock=1`, { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
  if (!response.ok) { await discard(response); throw new FlockError("flock_conflict", "The execution source could not be checked. Refresh and try again."); }
  const { snapshot } = await readCappedJson<{ snapshot: SessionSnapshot }>(response, REMOTE_LIMITS.sessionSnapshot);
  if (manager!.endpoint(id) !== endpoint || machine.state !== "connected" || !snapshot || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.workspaces)) throw new FlockError("flock_conflict", "The execution source changed. Refresh and try again.");
  return [{ ...machine, snapshot }];
}
