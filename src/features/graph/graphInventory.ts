import type { FlockRegistry } from "../../../shared/flock.ts";
import { flockTarget, type FlockRow } from "../../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { knownStatus } from "../../lib/status.ts";
import { flockHerdrEndpointKey, flockRelationships, flockRowRelationshipIds } from "../../../shared/flock-relationships.ts";
import { graphExecutionName } from "./graphNames.ts";
import { graphTerminalTabs } from "./graphTabs.ts";
import type { GraphData, GraphEdge, GraphNode } from "./graphModel.ts";

const executionId = (row: FlockRow) => {
  if (row.execution) return `execution:${row.execution.id}`;
  const binding = row.binding;
  if (binding) return `observed:${JSON.stringify([row.id, binding.machine_id, binding.herdr_lifetime, binding.pane_id, binding.agent, binding.native_session_id])}`;
  return `observed:${JSON.stringify([row.id, null, row.herdr_endpoint ? flockHerdrEndpointKey(row.herdr_endpoint) : null])}`;
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
export function graphInventory(registry: FlockRegistry | null, rows: readonly FlockRow[], machines: readonly Machine[] = [], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate): GraphData {
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
  const tabs = registry ? graphTerminalTabs(machines, labels, t) : [];
  for (const tab of tabs) for (const checkout of tab.checkouts) checkouts.set(checkout.id, checkout);
  const checkoutIds = new Map<string, string>();
  for (const checkout of checkouts.values()) {
    checkoutIds.set(checkout.id, `checkout:${JSON.stringify([checkout.machine_id, checkout.path, checkout.repository])}`);
  }
  for (const checkout of checkouts.values()) {
    const id = checkoutIds.get(checkout.id)!;
    if (nodes.has(id)) continue;
    nodes.set(id, { id, kind: "checkout", label: checkout.branch || checkout.path, machineId: checkout.machine_id, detail: checkout.path });
    if (checkout.repository) {
      const repositoryId = `repository:${JSON.stringify([checkout.machine_id, checkout.repository])}`;
      const worktree = machines.find((machine) => machine.id === checkout.machine_id)?.snapshot?.workspaces.find((workspace) => workspace.worktree?.repo_root === checkout.repository && workspace.worktree.repo_name)?.worktree;
      const name = worktree?.repo_name || checkout.repository.split(/[\\/]/).filter(Boolean).at(-1) || checkout.repository;
      nodes.set(repositoryId, { id: repositoryId, kind: "repository", label: name, repositoryKey: worktree?.repo_name || checkout.repository, machineId: checkout.machine_id, detail: checkout.repository });
      addEdge(id, repositoryId, "checkout-in-repository", `checkout.repository: ${checkout.repository}`);
    }
  }
  for (const row of rows) {
    if (!row.execution && row.session) continue;
    const id = executionId(row);
    nodes.set(id, { id, kind: "execution", label: graphExecutionName(row, machines, labels, t), machineId: row.machine_id, status: flockTarget(row) ? knownStatus(row.pane?.agent_status ?? row.status) : "unknown", freshness: freshness(row),
      detail: row.execution ? `${row.execution.agent} · ${row.execution.native_session_id}` : row.pane?.agent ?? "" });
    if (row.session) addEdge(id, `session:${row.session.id}`, "session-execution", `execution.session_id: ${row.session.id}`);
    if (row.checkout) addEdge(id, checkoutIds.get(row.checkout.id)!, "execution-in-checkout", row.execution ? `execution.checkout_id: ${row.execution.checkout_id}` : `inventory.checkout: ${row.checkout.path}`);
  }
  for (const tab of tabs) {
    nodes.set(tab.node.id, tab.node);
    const linked = new Set<string>();
    for (const checkout of tab.checkouts) {
      const target = checkoutIds.get(checkout.id)!;
      if (!linked.has(target)) addEdge(tab.node.id, target, "tab-in-checkout", `inventory.tab: ${checkout.path}`);
      linked.add(target);
    }
  }
  const relations = registry ? flockRelationships(registry) : [];
  const rowsByEndpoint = registry && relations.length ? endpointRowIndex(registry, rows) : new Map<string, FlockRow[]>();
  for (const relation of relations) {
    for (const endpoint of [relation.source, relation.target]) {
      if (nodes.has(endpoint.id)) continue;
      const matches = rowsByEndpoint.get(endpoint.id) ?? [], current = matches.length === 1 ? matches[0] : undefined;
      const live = current && flockTarget(current) !== null;
      nodes.set(endpoint.id, { id: endpoint.id, kind: "session", label: live ? graphExecutionName(current, machines, labels, t) : endpoint.label, machineId: endpoint.machine_id, detail: endpoint.native_session_id,
        status: live ? knownStatus(current.pane?.agent_status ?? current.status) : "unknown", freshness: live ? "live" : current?.availability ?? "unavailable" });
      if (current && !current.session) addEdge(executionId(current), endpoint.id, "session-execution", endpoint.herdr ? `Herdr ${endpoint.herdr.agent_instance_id}` : `native_session_id: ${endpoint.native_session_id}`);
    }
    edges.push({ id: `observed:${relation.id}`, source: relation.source.id, target: relation.target.id, kind: relation.kind,
      evidence: `${relation.sources.join("+")}.${relation.kind}`, eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
  }
  return { nodes: [...nodes.values()], edges: edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)) };
}

/** Resolve at action time. A live previous execution never substitutes for a missing current one. */
export function graphTarget(registry: FlockRegistry | null, rows: readonly FlockRow[], id: string, machines: readonly Machine[] = []): PaneTarget | null {
  if (!registry) return null;
  if (id.startsWith("tab:")) return graphTerminalTabs(machines).find((tab) => tab.node.id === id)?.target ?? null;
  if (id.startsWith("native:") || id.startsWith("herdr:")) {
    const endpoint = flockRelationships(registry).flatMap((relation) => [relation.source, relation.target]).find((endpoint) => endpoint.id === id);
    const matches = endpoint ? rows.filter((row) => flockRowRelationshipIds(registry, row).includes(endpoint.id)) : [];
    return endpoint && matches.length === 1 ? flockTarget(matches[0]!) : null;
  }
  const session = registry.sessions.find((session) => `session:${session.id}` === id);
  const row = session ? rows.find((row) => row.execution?.id === session.current_execution_id && row.session?.id === session.id)
    : rows.find((row) => (!row.session || row.execution) && executionId(row) === id);
  return row ? flockTarget(row) : null;
}
