import { graphCliPageValue, graphCliTerminalKey } from "../../../shared/graph-cli.ts";
import type { GraphCliPage, GraphRegistry } from "../../../shared/graph-registry.ts";
import { graphBinding, graphRowTarget, sameGraphBinding, type GraphRegistryRow } from "../../../shared/graph-registry-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { graphRelationships, graphRowRelationshipIds, type GraphRelationship } from "../../../shared/graph-relationships.ts";
import { graphHierarchy } from "./graphHierarchy.ts";
import { graphTabs } from "./graphTabs.ts";
import { graphPanes } from "./graphPanes.ts";
import type { GraphActivity, GraphData, GraphEdge, GraphNode } from "./graphModel.ts";

function appendReceipts(record: Pick<GraphEdge, "eventCount" | "lastObservedAt" | "sources">, relation: GraphRelationship): void {
  record.eventCount = (record.eventCount ?? 0) + relation.count;
  if (Date.parse(relation.last_at) > Date.parse(record.lastObservedAt!)) record.lastObservedAt = relation.last_at;
  record.sources = [...new Set([...record.sources ?? [], ...relation.sources])];
}

type Tab = ReturnType<typeof graphTabs>[number];
function rowTab(row: GraphRegistryRow, tabs: readonly Tab[]): Tab | undefined {
  return tabs.find((tab) => tab.machine.id === row.machine_id && tab.panes.some((pane) => {
    if (row.binding && pane.agent_session?.kind === "id" && row.binding.native_session_id !== pane.agent_session.value) return false;
    if (row.pane) return pane.pane_id === row.pane.pane_id && pane.terminal_id === row.pane.terminal_id && pane.agent === row.pane.agent;
    const binding = graphBinding(tab.machine, pane);
    return binding && row.binding && sameGraphBinding(binding, row.binding);
  }));
}

export function graphInventory(registry: GraphRegistry | null, rows: readonly GraphRegistryRow[], machines: readonly Machine[] = [], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate): GraphData {
  if (!registry) return { nodes: [], edges: [], groups: [] };
  const tabs = graphTabs(machines, labels, t, rows);
  const panes = graphPanes(tabs), entries = [...tabs, ...panes];
  const nodes = new Map<string, GraphNode>(entries.map((tab) => [tab.node.id, tab.node]));
  for (const tab of entries) {
    const agent = tab.panes.find((pane) => pane.agent);
    if (tab.node.freshness === "live" && agent && !rows.some((row) => row.machine_id === tab.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTab(row, [tab]) === tab && graphRowTarget(row))) {
      tab.node.freshness = "unsupported"; tab.node.status = "unknown";
    }
  }
  const endpoints = new Map<string, Set<string>>();
  const cliPages = new Map<Machine, GraphCliPage | null>();
  for (const tab of tabs) {
    let cli = cliPages.get(tab.machine);
    if (cli === undefined) {
      const candidate = tab.machine.snapshot?.graph_cli;
      cli = graphCliPageValue(candidate) ? candidate : null;
      cliPages.set(tab.machine, cli);
    }
    if (!cli || cli.boot_id !== tab.machine.snapshot?.herdr_lifetime || tab.machine.state !== "connected") continue;
    for (const pane of tab.panes) {
      if (!pane.terminal_id || pane.restore_error) continue;
      const endpoint = `terminal:${graphCliTerminalKey({ server_id: cli.server_id, boot_id: cli.boot_id, terminal_id: pane.terminal_id })}`;
      const represented = endpoints.get(endpoint) ?? new Set<string>();
      represented.add(tab.node.id); endpoints.set(endpoint, represented);
    }
  }

  for (const row of rows) {
    const tab = rowTab(row, tabs);
    if (!tab) continue;
    tab.node.detail = [...new Set([...tab.node.detail?.split("\n") ?? [], row.session?.name, row.work?.name, row.execution?.id, row.execution?.native_session_id, row.checkout?.branch, row.checkout?.path].filter(Boolean))].join("\n");
    if (row.session && row.execution?.id !== row.session.current_execution_id) continue;
    for (const endpoint of graphRowRelationshipIds(registry, row, machines)) {
      const ids = endpoints.get(endpoint) ?? new Set<string>();
      ids.add(tab.node.id); endpoints.set(endpoint, ids);
    }
  }
  const resolve = (id: string): string | null => {
    const represented = endpoints.get(id);
    return represented?.size === 1 ? [...represented][0]! : null;
  };
  const activity = new Map<string, Map<string, GraphActivity>>();
  const hierarchy = graphHierarchy(machines, tabs);
  for (const hub of hierarchy.nodes) nodes.set(hub.id, hub);
  const edges = new Map<string, GraphEdge>(hierarchy.edges.map((edge) => [edge.id, edge]));
  for (const pane of panes) edges.set(`parent:${pane.node.id}`, { id: `parent:${pane.node.id}`, source: pane.node.id, target: pane.parentId, kind: "pane-in-tab", evidence: "Herdr" });
  for (const relation of graphRelationships(registry)) {
    const source = resolve(relation.source.id), target = resolve(relation.target.id);
    if (!source || !target) {
      const tabId = source ?? target;
      if (!tabId) continue;
      const endpoint = source ? relation.target : relation.source;
      const direction = source ? "outgoing" : "incoming";
      const id = JSON.stringify([endpoint.id, relation.kind, direction]);
      const records = activity.get(tabId) ?? new Map<string, GraphActivity>();
      const previous = records.get(id);
      if (previous) appendReceipts(previous, relation);
      else records.set(id, { id, endpointId: endpoint.id, label: endpoint.label, kind: relation.kind, direction,
        eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
      activity.set(tabId, records);
      continue;
    }
    if (source === target) continue;
    const id = JSON.stringify([source, target, relation.kind]);
    const previous = edges.get(id);
    if (previous) {
      appendReceipts(previous, relation);
      previous.evidence = `${previous.sources!.join("+")}.${relation.kind}`;
    } else edges.set(id, { id, source, target, kind: relation.kind, evidence: `${relation.sources.join("+")}.${relation.kind}`,
      eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
  }
  for (const [tabId, records] of activity) nodes.get(tabId)!.activity = [...records.values()];
  return { nodes: [...nodes.values()], edges: [...edges.values()], groups: hierarchy.groups };
}

/** Opening a hub resolves only its own current tabs; it never follows a moved session. */
export function graphTarget(registry: GraphRegistry | null, rows: readonly GraphRegistryRow[], id: string, machines: readonly Machine[] = []): PaneTarget | null {
  if (!registry) return null;
  const tabs = graphTabs(machines, {}, defaultTranslate, rows);
  const tab = tabs.find((tab) => tab.node.id === id) ?? graphPanes(tabs).find((pane) => pane.node.id === id);
  if (tab) return tabTarget(tab, rows);
  const hub = graphHierarchy(machines, tabs).hubs.find((hub) => hub.node.id === id);
  if (!hub || hub.node.freshness !== "live") return null;
  for (const member of hub.tabs) { const target = tabTarget(member, rows); if (target) return target; }
  return null;
}

function tabTarget(tab: Tab, rows: readonly GraphRegistryRow[]): PaneTarget | null {
  if (tab.node.freshness !== "live") return null;
  const agent = tab.panes.find((pane) => pane.agent);
  if (!agent) return { machine_id: tab.machine.id, pane_id: tab.panes[0]!.pane_id };
  const candidates = rows.filter((row) => row.machine_id === tab.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTab(row, [tab]) === tab);
  const targets = candidates.map(graphRowTarget).filter((target) => target !== null);
  return targets.length > 0 && targets.every((target) => target.machine_id === tab.machine.id && target.pane_id === agent.pane_id) ? targets[0]! : null;
}
