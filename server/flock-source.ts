import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import type { MachineManager } from "./machines.ts";
import { FlockError } from "./flock.ts";
import { discard, readCappedJson, REMOTE_LIMITS } from "./remote-json.ts";

/** Adoption checks a fresh authoritative snapshot, rather than trusting a cached pane incarnation. */
export async function readFlockSource(manager: MachineManager | null, id: string, localSnapshot: () => Promise<SessionSnapshot>): Promise<readonly Machine[]> {
  const machine = manager?.list().find((item) => item.id === id);
  if (!machine || machine.state !== "connected") throw new FlockError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  if (machine.kind === "local") return [{ ...machine, snapshot: await localSnapshot() }];
  const endpoint = manager!.endpoint(id);
  if (!endpoint) throw new FlockError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  const response = await fetch(`${endpoint.url}/api/session`, { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
  if (!response.ok) { await discard(response); throw new FlockError("flock_conflict", "The execution source could not be checked. Refresh and try again."); }
  const { snapshot } = await readCappedJson<{ snapshot: SessionSnapshot }>(response, REMOTE_LIMITS.sessionSnapshot);
  if (manager!.endpoint(id) !== endpoint || machine.state !== "connected" || !snapshot || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.workspaces)) throw new FlockError("flock_conflict", "The execution source changed. Refresh and try again.");
  return [{ ...machine, snapshot }];
}
