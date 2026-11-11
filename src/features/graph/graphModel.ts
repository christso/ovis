import type { KnownStatus } from "../../lib/status.ts";

export type GraphKind = "workspace" | "worktree" | "terminal";
export type GraphStatus = KnownStatus;
export type GraphRelation = "worktree-in-workspace" | "terminal-in-workspace" | "terminal-in-worktree" | "delegation" | "communication";
export const DEFAULT_HIDDEN_KINDS: readonly GraphKind[] = [];

export interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  namedTerminal?: boolean;
  status?: GraphStatus;
  hasWorkingTerminals?: boolean;
  machineId?: string;
  freshness?: "live" | "stale" | "disconnected" | "unavailable" | "unsupported";
  detail?: string;
  repositoryKey?: string;
  repositoryName?: string;
  activity?: readonly GraphActivity[];
}
export const graphNodeIsWorking = (node: GraphNode): boolean => node.status === "working" || node.hasWorkingTerminals === true;
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphRelation;
  /** Human-readable source evidence from the inventory, never a guessed relationship. */
  evidence: string;
  eventCount?: number;
  lastObservedAt?: string;
  sources?: readonly ("codex" | "herdr" | "herdr-cli")[];
}
export interface GraphActivity {
  id: string;
  endpointId: string;
  label: string;
  kind: "delegation" | "communication";
  direction: "incoming" | "outgoing";
  eventCount: number;
  lastObservedAt: string;
  sources: readonly ("codex" | "herdr" | "herdr-cli")[];
}
export interface GraphGroup { id: string; label: string; machineId: string; nodeIds: readonly string[] }
export interface GraphData { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; groups?: readonly GraphGroup[] }
export interface GraphFilters { search: string; status: string; machine: string; focus: string; showCompleted: boolean; communication?: "recent" | "all" | "none"; hiddenKinds?: readonly GraphKind[] }

const RELATIONS = new Set<GraphRelation>(["worktree-in-workspace", "terminal-in-workspace", "terminal-in-worktree", "delegation", "communication"]);

/** Type visibility projects established ancestry; other filters still select original endpoints. */
export function projectGraph(data: GraphData, filters: GraphFilters, now = Date.now()) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const edges = data.edges.filter((edge) => RELATIONS.has(edge.kind) && edge.evidence.trim() && byId.has(edge.source) && byId.has(edge.target)
    && (edge.kind !== "communication" || (filters.communication !== "none" && (filters.communication === "all" || Date.parse(edge.lastObservedAt ?? "") >= now - 86400_000))));
  const relationship = (edge: GraphEdge) => edge.kind === "delegation" || edge.kind === "communication";
  const parents = new Map<string, string[]>(), children = new Map<string, string[]>();
  for (const edge of edges) {
    if (relationship(edge)) continue;
    const ancestors = parents.get(edge.source) ?? [];
    ancestors.push(edge.target); parents.set(edge.source, ancestors);
    const descendants = children.get(edge.target) ?? [];
    descendants.push(edge.source); children.set(edge.target, descendants);
  }
  const extend = (ids: Set<string>, adjacency: Map<string, string[]>) => {
    const queue = [...ids];
    for (let at = 0; at < queue.length; at++) for (const id of adjacency.get(queue[at]!) ?? []) {
      if (!ids.has(id)) { ids.add(id); queue.push(id); }
    }
  };
  const words = filters.search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const eligible = new Set(data.nodes.filter((node) => (filters.showCompleted || node.kind !== "terminal" || node.status !== "done")
    && (!filters.status || (node.status ?? "unknown") === filters.status || (filters.status === "working" && graphNodeIsWorking(node)))
    && (!filters.machine || node.machineId === filters.machine)
    && words.every((word) => `${node.label}\n${node.detail ?? ""}`.toLocaleLowerCase().includes(word))).map((node) => node.id));
  extend(eligible, parents);
  const hidden = filters.hiddenKinds ?? DEFAULT_HIDDEN_KINDS;
  const visible = new Set(data.nodes.filter((node) => eligible.has(node.id) && !hidden.includes(node.kind)).map((node) => node.id));
  const representatives = new Map<string, string | null>();
  const represent = (id: string): string | null => {
    if (representatives.has(id)) return representatives.get(id)!;
    if (!eligible.has(id)) return null;
    let level = [id];
    const visited = new Set<string>();
    while (level.length) {
      const matches = [...new Set(level.filter((node) => visible.has(node)))];
      if (matches.length) {
        const result = matches.length === 1 ? matches[0]! : null;
        representatives.set(id, result); return result;
      }
      const next: string[] = [];
      for (const node of level) {
        if (visited.has(node)) continue;
        visited.add(node); next.push(...parents.get(node) ?? []);
      }
      level = next;
    }
    representatives.set(id, null); return null;
  };
  let focused: Set<string> | null = null;
  const group = data.groups?.find((group) => group.id === filters.focus);
  if (filters.focus) {
    const seeds = group ? group.nodeIds : byId.has(filters.focus) ? [filters.focus] : [];
    const members = new Set(seeds);
    extend(members, children);
    const selected = new Set([...members].filter((id) => eligible.has(id)));
    const roots = group ? seeds.filter((id) => !(parents.get(id) ?? []).some((parent) => members.has(parent))) : seeds;
    const collapsed = [...selected].filter((id) => hidden.includes(byId.get(id)!.kind));
    const anchors = new Set([...roots, ...collapsed].flatMap((id) => { const target = represent(id); return target ? [target] : []; }));
    focused = new Set(selected);
    for (const edge of edges) {
      if (!relationship(edge)) continue;
      const source = represent(edge.source), target = represent(edge.target);
      if (!source || !target || source === target) continue;
      if (selected.has(edge.source) && anchors.has(source)) focused.add(edge.target);
      if (selected.has(edge.target) && anchors.has(target)) focused.add(edge.source);
    }
    extend(focused, parents);
  }
  const projected = new Map<string, GraphEdge>();
  const seen = new Set<string>();
  for (const edge of edges) {
    if (seen.has(edge.id)) continue;
    seen.add(edge.id);
    if (!relationship(edge)) {
      if (!visible.has(edge.source)) continue;
      const target = represent(edge.target);
      if (!target || target === edge.source) continue;
      const kind = byId.get(edge.source)!.kind === "worktree" ? "worktree-in-workspace"
        : byId.get(target)!.kind === "worktree" ? "terminal-in-worktree" : "terminal-in-workspace";
      projected.set(edge.id, { ...edge, target, kind });
      continue;
    }
    if (focused && (!focused.has(edge.source) || !focused.has(edge.target))) continue;
    const source = represent(edge.source), target = represent(edge.target);
    if (!source || !target || source === target) continue;
    const key = JSON.stringify([source, target, edge.kind]);
    const before = projected.get(key);
    if (!before) {
      projected.set(key, { ...edge, source, target, id: source === edge.source && target === edge.target ? edge.id : `projected:${key}` });
      continue;
    }
    before.id = `projected:${key}`;
    if (edge.eventCount !== undefined) before.eventCount = (before.eventCount ?? 0) + edge.eventCount;
    if (edge.lastObservedAt && (!before.lastObservedAt || Date.parse(edge.lastObservedAt) > Date.parse(before.lastObservedAt))) before.lastObservedAt = edge.lastObservedAt;
    before.sources = [...new Set([...before.sources ?? [], ...edge.sources ?? []])].sort();
    before.evidence = [...new Set([before.evidence, edge.evidence])].join("; ");
  }
  const kept = new Set([...visible].filter((id) => !focused || focused.has(id)));
  return {
    nodes: data.nodes.filter((node) => kept.has(node.id)),
    edges: [...projected.values()].filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    focusMissing: !!filters.focus && !byId.has(filters.focus) && !group,
  };
}
