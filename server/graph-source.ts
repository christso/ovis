import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import type { MachineManager } from "./machines.ts";
import { codexPaneCoordination } from "./codex.ts";
import { GraphRegistryError } from "./graph-registry.ts";
import { discard, readCappedJson, REMOTE_LIMITS } from "./remote-json.ts";
import { retainCodexCoordinationScans } from "./codex-relationships.ts";
import { herdrCoordinationSnapshot } from "./herdr-coordination.ts";
import { herdrCliObservations, herdrCliSnapshot } from "./herdr/cli-observations.ts";
import { graphHerdrEndpointKey } from "../shared/graph-relationships.ts";

/** Proof is bridge-owned and ephemeral. Unsupported readers never promote a raw native-session hint. */
export async function verifyGraphSnapshot(readSnapshot: () => Promise<SessionSnapshot>, codexHome?: string): Promise<SessionSnapshot> {
  const snapshot = await readSnapshot();
  const cliBefore = await herdrCliObservations();
  const forkBefore = await herdrCoordinationSnapshot();
  const coordinationBefore = forkBefore ?? await herdrCliSnapshot(snapshot);
  const flock_bindings: NonNullable<SessionSnapshot["flock_bindings"]> = [];
  const observations = new Map<string, NonNullable<SessionSnapshot["flock_observations"]>>();
  const paths = new Map<string, string>();
  if (snapshot.herdr_lifetime) for (const pane of snapshot.panes) {
    if (pane.agent !== "codex" || !pane.cwd || pane.restore_error) continue;
    try {
      const source = await codexPaneCoordination(pane.pane_id, pane.cwd, codexHome, snapshot.panes);
      if (source) {
        flock_bindings.push({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent, native_session_id: source.id });
        observations.set(pane.pane_id, source.observations);
        paths.set(pane.pane_id, source.rolloutPath);
      }
    } catch { /* uncertain ownership remains visible but unsupported */ }
  }
  const current = await readSnapshot();
  const cli = cliBefore ? await herdrCliObservations() : undefined;
  const coordination = coordinationBefore ? forkBefore ? await herdrCoordinationSnapshot() : await herdrCliSnapshot(current) : undefined;
  const daemonChanged = coordinationBefore && coordination && (coordinationBefore.server_id !== coordination.server_id || coordinationBefore.boot_id !== coordination.boot_id);
  const proven = current.herdr_lifetime !== snapshot.herdr_lifetime || daemonChanged ? [] : flock_bindings.filter((proof) => {
    const before = snapshot.panes.find((pane) => pane.pane_id === proof.pane_id);
    const after = current.panes.find((pane) => pane.pane_id === proof.pane_id);
    const previousOccupant = coordinationBefore?.agents.filter((endpoint) => endpoint.pane_id === proof.pane_id && endpoint.terminal_id === proof.terminal_id && endpoint.agent === proof.agent);
    const currentOccupant = coordination?.agents.filter((endpoint) => endpoint.pane_id === proof.pane_id && endpoint.terminal_id === proof.terminal_id && endpoint.agent === proof.agent);
    const comparable = previousOccupant?.length === 1 && currentOccupant?.length === 1;
    // Optional CLI inspection cannot disprove independent native ownership by finding nothing.
    // A positive process replacement still invalidates it; the fork keeps its occupancy guard.
    const sameOccupant = !coordinationBefore || !coordination || (!forkBefore && !comparable) || (comparable
      && graphHerdrEndpointKey(previousOccupant[0]!) === graphHerdrEndpointKey(currentOccupant[0]!));
    return sameOccupant && after && after.terminal_id === proof.terminal_id && after.agent === proof.agent && !after.restore_error && after.cwd === before?.cwd;
  });
  retainCodexCoordinationScans(new Set(proven.flatMap((proof) => paths.get(proof.pane_id) ?? [])));
  const sameDaemon = coordinationBefore && coordination && current.herdr_lifetime === snapshot.herdr_lifetime
    && coordination.server_id === coordinationBefore.server_id && coordination.boot_id === coordinationBefore.boot_id;
  const agents = sameDaemon ? coordination.agents.filter((endpoint) => {
    const beforeEndpoint = coordinationBefore.agents.find((item) => graphHerdrEndpointKey(item) === graphHerdrEndpointKey(endpoint));
    const before = snapshot.panes.find((pane) => pane.pane_id === beforeEndpoint?.pane_id);
    const after = current.panes.find((pane) => pane.pane_id === endpoint.pane_id);
    return beforeEndpoint && before && after && before.terminal_id === endpoint.terminal_id && after.terminal_id === endpoint.terminal_id
      && before.agent === endpoint.agent && after.agent === endpoint.agent && !before.restore_error && !after.restore_error;
  }) : [];
  return { ...current, flock_bindings: proven, flock_observations: proven.flatMap((proof) => observations.get(proof.pane_id) ?? []),
    flock_coordination: sameDaemon && forkBefore ? { ...forkBefore, ...coordination, agents } : undefined,
    graph_cli: cli && cliBefore && cli.server_id === cliBefore.server_id && cli.boot_id === cliBefore.boot_id && current.herdr_lifetime === snapshot.herdr_lifetime
      ? { ...cli, current_agents: sameDaemon && !forkBefore ? agents : undefined,
        // The fork covers this boot's same-daemon operations. Earlier boots and named-session
        // receipts have distinct provenance; source capability alone cannot prove their overlap.
        receipts: sameDaemon && forkBefore ? cli.receipts.filter((event) => ![event.source_terminal, event.target_terminal].every((terminal) => terminal.server_id === cli.server_id && terminal.boot_id === cli.boot_id)) : cli.receipts } : undefined };
}

/** Adoption checks fresh native ownership as well as the pane incarnation. Older peers fail closed. */
export async function readGraphSource(manager: MachineManager | null, id: string, localSnapshot: () => Promise<SessionSnapshot>, codexHome?: string): Promise<readonly Machine[]> {
  const machine = manager?.list().find((item) => item.id === id);
  if (!machine || machine.state !== "connected") throw new GraphRegistryError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  if (machine.kind === "local") return [{ ...machine, snapshot: await verifyGraphSnapshot(localSnapshot, codexHome) }];
  const endpoint = manager!.endpoint(id);
  if (!endpoint) throw new GraphRegistryError("flock_conflict", "The execution source is unavailable. Refresh and try again.");
  const response = await fetch(`${endpoint.url}/api/session?flock=1`, { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(15_000), redirect: "manual" });
  if (!response.ok) { await discard(response); throw new GraphRegistryError("flock_conflict", "The execution source could not be checked. Refresh and try again."); }
  const { snapshot } = await readCappedJson<{ snapshot: SessionSnapshot }>(response, REMOTE_LIMITS.sessionSnapshot);
  if (manager!.endpoint(id) !== endpoint || machine.state !== "connected" || !snapshot || !Array.isArray(snapshot.panes) || !Array.isArray(snapshot.workspaces)) throw new GraphRegistryError("flock_conflict", "The execution source changed. Refresh and try again.");
  return [{ ...machine, snapshot }];
}
