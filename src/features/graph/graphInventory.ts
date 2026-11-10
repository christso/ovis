import type { FlockRegistry } from "../../../shared/flock.ts";
import { flockBinding, flockTarget, sameFlockBinding, type FlockRow } from "../../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { flockRelationships, flockRowRelationshipIds } from "../../../shared/flock-relationships.ts";
import { graphTabs, graphWorkspaceGroups } from "./graphTabs.ts";
import type { GraphData, GraphEdge, GraphNode } from "./graphModel.ts";

type Tab = ReturnType<typeof graphTabs>[number];
function rowTab(row: FlockRow, tabs: readonly Tab[]): Tab | undefined {
  return tabs.find((tab) => tab.machine.id === row.machine_id && tab.panes.some((pane) => {
    if (row.binding && pane.agent_session?.kind === "id" && row.binding.native_session_id !== pane.agent_session.value) return false;
    if (row.pane) return pane.pane_id === row.pane.pane_id && pane.terminal_id === row.pane.terminal_id && pane.agent === row.pane.agent;
    const binding = flockBinding(tab.machine, pane);
    return binding && row.binding && sameFlockBinding(binding, row.binding);
  }));
}

export function graphInventory(registry: FlockRegistry | null, rows: readonly FlockRow[], machines: readonly Machine[] = [], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate): GraphData {
  if (!registry) return { nodes: [], edges: [], groups: [] };
  const tabs = graphTabs(machines, labels, t, rows);
  const nodes = new Map<string, GraphNode>(tabs.map((tab) => [tab.node.id, tab.node]));
  for (const tab of tabs) {
    const agent = tab.panes.find((pane) => pane.agent);
    if (tab.node.freshness === "live" && agent && !rows.some((row) => row.machine_id === tab.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTab(row, [tab]) === tab && flockTarget(row))) {
      tab.node.freshness = "unsupported"; tab.node.status = "unknown";
    }
  }
  const endpoints = new Map<string, Set<string>>();
  for (const row of rows) {
    const tab = rowTab(row, tabs);
    if (!tab) continue;
    tab.node.detail = [...new Set([...tab.node.detail?.split("\n") ?? [], row.session?.name, row.work?.name, row.execution?.id, row.execution?.native_session_id, row.checkout?.branch, row.checkout?.path].filter(Boolean))].join("\n");
    if (row.session && row.execution?.id !== row.session.current_execution_id) continue;
    for (const endpoint of flockRowRelationshipIds(registry, row, machines)) {
      const ids = endpoints.get(endpoint) ?? new Set<string>();
      ids.add(tab.node.id); endpoints.set(endpoint, ids);
    }
  }
  const resolve = (endpoint: ReturnType<typeof flockRelationships>[number]["source"]): string => {
    const represented = endpoints.get(endpoint.id);
    if (represented?.size === 1) return [...represented][0]!;
    if (!nodes.has(endpoint.id)) nodes.set(endpoint.id, { id: endpoint.id, kind: "session", label: endpoint.label,
      machineId: endpoint.machine_id, detail: endpoint.native_session_id, status: "unknown", freshness: "unavailable" });
    return endpoint.id;
  };
  const edges = new Map<string, GraphEdge>();
  for (const relation of flockRelationships(registry)) {
    const source = resolve(relation.source), target = resolve(relation.target);
    if (source === target) continue;
    const id = JSON.stringify([source, target, relation.kind]);
    const previous = edges.get(id);
    if (previous) {
      previous.eventCount = (previous.eventCount ?? 0) + relation.count;
      if (Date.parse(relation.last_at) > Date.parse(previous.lastObservedAt!)) previous.lastObservedAt = relation.last_at;
      previous.sources = [...new Set([...previous.sources ?? [], ...relation.sources])];
      previous.evidence = `${previous.sources.join("+")}.${relation.kind}`;
    } else edges.set(id, { id, source, target, kind: relation.kind, evidence: `${relation.sources.join("+")}.${relation.kind}`,
      eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], groups: graphWorkspaceGroups(machines, tabs) };
}

/** Rebuild the exact tab/occupant identity at action time; no historical node can open its replacement. */
export function graphTarget(registry: FlockRegistry | null, rows: readonly FlockRow[], id: string, machines: readonly Machine[] = []): PaneTarget | null {
  if (!registry) return null;
  const tab = graphTabs(machines, {}, defaultTranslate, rows).find((tab) => tab.node.id === id);
  if (!tab || tab.node.freshness !== "live") return null;
  const agent = tab.panes.find((pane) => pane.agent);
  if (!agent) return { machine_id: tab.machine.id, pane_id: tab.panes[0]!.pane_id };
  const candidates = rows.filter((row) => row.machine_id === tab.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTab(row, [tab]) === tab);
  const targets = candidates.map(flockTarget).filter((target) => target !== null);
  return targets.length > 0 && targets.every((target) => target.machine_id === tab.machine.id && target.pane_id === agent.pane_id) ? targets[0]! : null;
}
