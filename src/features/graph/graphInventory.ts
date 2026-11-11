import { graphCliPageValue, graphCliTerminalKey } from "../../../shared/graph-cli.ts";
import type { GraphCliPage, GraphRegistry } from "../../../shared/graph-registry.ts";
import { graphBinding, graphRowTarget, sameGraphBinding, type GraphRegistryRow } from "../../../shared/graph-registry-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { graphRelationships, graphRowRelationshipIds, type GraphRelationship } from "../../../shared/graph-relationships.ts";
import { graphHierarchy } from "./graphHierarchy.ts";
import { graphTerminals } from "./graphTerminals.ts";
import type { GraphActivity, GraphData, GraphEdge, GraphNode } from "./graphModel.ts";

function appendReceipts(record: Pick<GraphEdge, "eventCount" | "lastObservedAt" | "sources">, relation: GraphRelationship): void {
  record.eventCount = (record.eventCount ?? 0) + relation.count;
  if (Date.parse(relation.last_at) > Date.parse(record.lastObservedAt!)) record.lastObservedAt = relation.last_at;
  record.sources = [...new Set([...record.sources ?? [], ...relation.sources])];
}

type Terminal = ReturnType<typeof graphTerminals>[number];
function rowTerminal(row: GraphRegistryRow, terminals: readonly Terminal[]): Terminal | undefined {
  return terminals.find((terminal) => terminal.machine.id === row.machine_id && terminal.panes.some((pane) => {
    if (row.binding && pane.agent_session?.kind === "id" && row.binding.native_session_id !== pane.agent_session.value) return false;
    if (row.pane) return pane.pane_id === row.pane.pane_id && pane.terminal_id === row.pane.terminal_id && pane.agent === row.pane.agent;
    const binding = graphBinding(terminal.machine, pane);
    return binding && row.binding && sameGraphBinding(binding, row.binding);
  }));
}

export function graphInventory(registry: GraphRegistry | null, rows: readonly GraphRegistryRow[], machines: readonly Machine[] = [], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate): GraphData {
  if (!registry) return { nodes: [], edges: [], groups: [] };
  const terminals = graphTerminals(machines, labels, t, rows);
  const nodes = new Map<string, GraphNode>(terminals.map((terminal) => [terminal.node.id, terminal.node]));
  for (const terminal of terminals) {
    const agent = terminal.panes.find((pane) => pane.agent);
    if (terminal.node.freshness === "live" && agent && !rows.some((row) => row.machine_id === terminal.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTerminal(row, [terminal]) === terminal && graphRowTarget(row))) {
      terminal.node.freshness = "unsupported"; terminal.node.status = "unknown";
    }
  }
  const endpoints = new Map<string, Set<string>>();
  const cliPages = new Map<Machine, GraphCliPage | null>();
  for (const terminal of terminals) {
    let cli = cliPages.get(terminal.machine);
    if (cli === undefined) {
      const candidate = terminal.machine.snapshot?.graph_cli;
      cli = graphCliPageValue(candidate) ? candidate : null;
      cliPages.set(terminal.machine, cli);
    }
    if (!cli || cli.boot_id !== terminal.machine.snapshot?.herdr_lifetime || terminal.machine.state !== "connected") continue;
    for (const pane of terminal.panes) {
      if (!pane.terminal_id || pane.restore_error) continue;
      const endpoint = `terminal:${graphCliTerminalKey({ server_id: cli.server_id, boot_id: cli.boot_id, terminal_id: pane.terminal_id })}`;
      const represented = endpoints.get(endpoint) ?? new Set<string>();
      represented.add(terminal.node.id); endpoints.set(endpoint, represented);
    }
  }

  for (const row of rows) {
    const terminal = rowTerminal(row, terminals);
    if (!terminal) continue;
    terminal.node.detail = [...new Set([...terminal.node.detail?.split("\n") ?? [], row.session?.name, row.work?.name, row.execution?.id, row.execution?.native_session_id, row.checkout?.branch, row.checkout?.path].filter(Boolean))].join("\n");
    if (row.session && row.execution?.id !== row.session.current_execution_id) continue;
    for (const endpoint of graphRowRelationshipIds(registry, row, machines)) {
      const ids = endpoints.get(endpoint) ?? new Set<string>();
      ids.add(terminal.node.id); endpoints.set(endpoint, ids);
    }
  }
  const resolve = (id: string): string | null => {
    const represented = endpoints.get(id);
    return represented?.size === 1 ? [...represented][0]! : null;
  };
  const activity = new Map<string, Map<string, GraphActivity>>();
  const hierarchy = graphHierarchy(machines, terminals, t);
  for (const hub of hierarchy.nodes) nodes.set(hub.id, hub);
  const edges = new Map<string, GraphEdge>(hierarchy.edges.map((edge) => [edge.id, edge]));
  for (const relation of graphRelationships(registry)) {
    const source = resolve(relation.source.id), target = resolve(relation.target.id);
    if (!source || !target) {
      const terminalId = source ?? target;
      if (!terminalId) continue;
      const endpoint = source ? relation.target : relation.source;
      const direction = source ? "outgoing" : "incoming";
      const id = JSON.stringify([endpoint.id, relation.kind, direction]);
      const records = activity.get(terminalId) ?? new Map<string, GraphActivity>();
      const previous = records.get(id);
      if (previous) appendReceipts(previous, relation);
      else records.set(id, { id, endpointId: endpoint.id, label: endpoint.label, kind: relation.kind, direction,
        eventCount: relation.count, lastObservedAt: relation.last_at, sources: relation.sources });
      activity.set(terminalId, records);
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
  for (const [terminalId, records] of activity) nodes.get(terminalId)!.activity = [...records.values()];
  return { nodes: [...nodes.values()], edges: [...edges.values()], groups: hierarchy.groups };
}

/** Opening a hub resolves only its own current terminals; it never follows a moved session. */
export function graphTarget(registry: GraphRegistry | null, rows: readonly GraphRegistryRow[], id: string, machines: readonly Machine[] = []): PaneTarget | null {
  if (!registry) return null;
  const terminals = graphTerminals(machines, {}, defaultTranslate, rows);
  const terminal = terminals.find((terminal) => terminal.node.id === id);
  if (terminal) return terminalTarget(terminal, rows);
  const hub = graphHierarchy(machines, terminals).hubs.find((hub) => hub.node.id === id);
  if (!hub || hub.node.freshness !== "live") return null;
  for (const member of hub.terminals) { const target = terminalTarget(member, rows); if (target) return target; }
  return null;
}

function terminalTarget(terminal: Terminal, rows: readonly GraphRegistryRow[]): PaneTarget | null {
  if (terminal.node.freshness !== "live") return null;
  const agent = terminal.panes.find((pane) => pane.agent);
  if (!agent) return { machine_id: terminal.machine.id, pane_id: terminal.panes[0]!.pane_id };
  const candidates = rows.filter((row) => row.machine_id === terminal.machine.id && row.pane?.pane_id === agent.pane_id && row.pane.terminal_id === agent.terminal_id && rowTerminal(row, [terminal]) === terminal);
  const targets = candidates.map(graphRowTarget).filter((target) => target !== null);
  return targets.length > 0 && targets.every((target) => target.machine_id === terminal.machine.id && target.pane_id === agent.pane_id) ? targets[0]! : null;
}
