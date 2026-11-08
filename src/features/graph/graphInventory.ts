import type { FlockRegistry } from "../../../shared/flock.ts";
import { flockTarget, type FlockRow } from "../../../shared/flock-inventory.ts";
import type { PaneTarget } from "../../../shared/machines.ts";
import { knownStatus } from "../../lib/status.ts";
import { flockHerdrEndpointKey, flockRelationships, flockRowRelationshipIds } from "../../../shared/flock-relationships.ts";
import type { GraphData, GraphEdge, GraphNode } from "./graphModel.ts";

const executionId = (row: FlockRow) => {
  if (row.execution) return `execution:${row.execution.id}`;
  const binding = row.binding;
  return `observed:${JSON.stringify([...(binding ? [row.id, binding.machine_id, binding.herdr_lifetime, binding.pane_id, binding.agent, binding.native_session_id] : [row.id, null]), row.herdr_endpoint ? flockHerdrEndpointKey(row.herdr_endpoint) : null])}`;
};
const freshness = (row: FlockRow): GraphNode["freshness"] => flockTarget(row) ? "live" : row.availability;
function endpointRowIndex(registry: FlockRegistry, rows: readonly FlockRow[]): Map<string, FlockRow[]> {
  const index = new Map<string, FlockRow[]>();
  for (const row of rows) for (const id of flockRowRelationshipIds(registry, row)) {
    const matches = index.get(id);
    if (matches) matches.push(row); else index.set(id, [row]);
  }
  return index;
}

/** A rendering adapter over the ONE shared inventory. Paths label physical metadata only. */
export function graphInventory(registry: FlockRegistry | null, rows: readonly FlockRow[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addEdge = (source: string, target: string, kind: GraphEdge["kind"], evidence: string) => edges.push({ id: JSON.stringify([source, target, kind]), source, target, kind, evidence });
  for (const work of registry?.works ?? []) nodes.set(`work:${work.id}`, { id: `work:${work.id}`, kind: "work", label: work.name });
  for (const session of registry?.sessions ?? []) {
    const current = rows.find((row) => row.execution?.id === session.current_execution_id && row.session?.id === session.id);
    nodes.set(`session:${session.id}`, { id: `session:${session.id}`, kind: "session", label: session.name,
      status: current?.availability === "live" ? knownStatus(current.status) : "unknown", freshness: current ? freshness(current) : "unavailable" });
    if (session.work_id) addEdge(`session:${session.id}`, `work:${session.work_id}`, "work-session", `session.work_id: ${session.work_id}`);
  }
  const checkouts = new Map((registry?.checkouts ?? []).map((checkout) => [checkout.id, checkout]));
  for (const row of rows) if (row.checkout) checkouts.set(row.checkout.id, row.checkout);
  for (const checkout of checkouts.values()) {
    const id = `checkout:${checkout.id}`;
    nodes.set(id, { id, kind: "checkout", label: checkout.branch || checkout.path, machineId: checkout.machine_id, detail: checkout.path });
    if (checkout.repository) {
      const repositoryId = `repository:${JSON.stringify([checkout.machine_id, checkout.repository])}`;
      nodes.set(repositoryId, { id: repositoryId, kind: "repository", label: checkout.repository, machineId: checkout.machine_id, detail: checkout.repository });
      addEdge(id, repositoryId, "checkout-in-repository", `checkout.repository: ${checkout.repository}`);
    }
  }
  for (const row of rows) {
    if (!row.execution && row.session) continue;
    const id = executionId(row);
    nodes.set(id, { id, kind: "execution", label: row.name, machineId: row.machine_id, status: flockTarget(row) ? knownStatus(row.pane?.agent_status ?? row.status) : "unknown", freshness: freshness(row),
      detail: row.execution ? `${row.execution.agent} · ${row.execution.native_session_id}` : row.pane?.agent ?? "" });
    if (row.session) addEdge(id, `session:${row.session.id}`, "session-execution", `execution.session_id: ${row.session.id}`);
    if (row.checkout) addEdge(id, `checkout:${row.checkout.id}`, "execution-in-checkout", row.execution ? `execution.checkout_id: ${row.execution.checkout_id}` : `inventory.checkout: ${row.checkout.path}`);
  }
  const relations = registry ? flockRelationships(registry) : [];
  const rowsByEndpoint = registry && relations.length ? endpointRowIndex(registry, rows) : new Map<string, FlockRow[]>();
  for (const relation of relations) {
    for (const endpoint of [relation.source, relation.target]) {
      if (nodes.has(endpoint.id)) continue;
      const matches = rowsByEndpoint.get(endpoint.id) ?? [], current = matches.length === 1 ? matches[0] : undefined;
      const live = current && flockTarget(current) !== null;
      nodes.set(endpoint.id, { id: endpoint.id, kind: "session", label: endpoint.label, machineId: endpoint.machine_id, detail: endpoint.native_session_id,
        status: live ? knownStatus(current.pane?.agent_status ?? current.status) : "unknown", freshness: live ? "live" : current?.availability ?? "unavailable" });
      if (current && !current.session) addEdge(executionId(current), endpoint.id, "session-execution", endpoint.herdr ? `Herdr ${endpoint.herdr.agent_instance_id}` : `native_session_id: ${endpoint.native_session_id}`);
    }
    edges.push({ id: `observed:${relation.id}`, source: relation.source.id, target: relation.target.id, kind: relation.kind,
      evidence: `${relation.sources.join("+")}.${relation.kind}`, eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
  }
  return { nodes: [...nodes.values()], edges: edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)) };
}

/** Resolve at action time. A live previous execution never substitutes for a missing current one. */
export function graphTarget(registry: FlockRegistry | null, rows: readonly FlockRow[], id: string): PaneTarget | null {
  if (!registry) return null;
  if (id.startsWith("native:") || id.startsWith("herdr:")) {
    const endpoint = flockRelationships(registry).flatMap((relation) => [relation.source, relation.target]).find((endpoint) => endpoint.id === id);
    const matches = endpoint ? endpointRowIndex(registry, rows).get(endpoint.id) ?? [] : [];
    return endpoint && matches.length === 1 ? flockTarget(matches[0]!) : null;
  }
  const session = registry.sessions.find((session) => `session:${session.id}` === id);
  const row = session ? rows.find((row) => row.execution?.id === session.current_execution_id && row.session?.id === session.id)
    : rows.find((row) => (!row.session || row.execution) && executionId(row) === id);
  return row ? flockTarget(row) : null;
}
