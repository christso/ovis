import type { KnownStatus } from "../../lib/status.ts";

export type GraphKind = "workspace" | "worktree" | "tab" | "pane";
export type GraphStatus = KnownStatus;
export type GraphRelation = "worktree-in-workspace" | "tab-in-workspace" | "tab-in-worktree" | "pane-in-tab" | "delegation" | "communication";
export const DEFAULT_HIDDEN_KINDS: readonly GraphKind[] = ["pane"];

export interface GraphNode {
  id: string;
  kind: GraphKind;
  label: string;
  namedTab?: boolean;
  status?: GraphStatus;
  machineId?: string;
  freshness?: "live" | "stale" | "disconnected" | "unavailable" | "unsupported";
  detail?: string;
  repositoryKey?: string;
  repositoryName?: string;
  activity?: readonly GraphActivity[];
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphRelation;
  /** Human-readable source evidence from the inventory, never a guessed relationship. */
  evidence: string;
  eventCount?: number;
  lastObservedAt?: string;
  sources?: readonly ("codex" | "herdr")[];
}
export interface GraphActivity {
  id: string;
  endpointId: string;
  label: string;
  kind: "delegation" | "communication";
  direction: "incoming" | "outgoing";
  eventCount: number;
  lastObservedAt: string;
  sources: readonly ("codex" | "herdr")[];
}
export interface GraphGroup { id: string; label: string; machineId: string; nodeIds: readonly string[] }
export interface GraphData { nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; groups?: readonly GraphGroup[] }
export interface GraphFilters { search: string; status: string; machine: string; focus: string; showCompleted: boolean; communication?: "recent" | "all" | "none"; hiddenKinds?: readonly GraphKind[] }

const RELATIONS = new Set<GraphRelation>(["worktree-in-workspace", "tab-in-workspace", "tab-in-worktree", "pane-in-tab", "delegation", "communication"]);

/** Filters match work first; established outgoing containment links retain its context. */
export function projectGraph(data: GraphData, filters: GraphFilters, now = Date.now()) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const edges = data.edges.filter((edge) => RELATIONS.has(edge.kind) && edge.evidence.trim() && byId.has(edge.source) && byId.has(edge.target)
    && (edge.kind !== "communication" || (filters.communication !== "none" && (filters.communication === "all" || Date.parse(edge.lastObservedAt ?? "") >= now - 86400_000))));
  const parents = new Map<string, string[]>(), children = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === "delegation" || edge.kind === "communication") continue;
    const ancestors = parents.get(edge.source) ?? [];
    ancestors.push(edge.target); parents.set(edge.source, ancestors);
    const descendants = children.get(edge.target) ?? [];
    descendants.push(edge.source); children.set(edge.target, descendants);
  }
  let focused: Set<string> | null = null;
  if (filters.focus) {
    const group = data.groups?.find((group) => group.id === filters.focus);
    focused = new Set(group ? group.nodeIds : byId.has(filters.focus) ? [filters.focus] : []);
    for (const adjacency of [children, parents]) {
      const queue = [...focused];
      for (let at = 0; at < queue.length; at++) {
        for (const id of adjacency.get(queue[at]!) ?? []) {
          if (!focused.has(id)) { focused.add(id); queue.push(id); }
        }
      }
    }
    for (const edge of edges) {
      if ((edge.kind === "delegation" || edge.kind === "communication") && edge.source === filters.focus) focused.add(edge.target);
      if ((edge.kind === "delegation" || edge.kind === "communication") && edge.target === filters.focus) focused.add(edge.source);
    }
  }
  const words = filters.search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const allowed = (node: GraphNode) => !(filters.hiddenKinds ?? DEFAULT_HIDDEN_KINDS).includes(node.kind) && (filters.showCompleted || (node.kind !== "tab" && node.kind !== "pane") || node.status !== "done") && (!focused || focused.has(node.id));
  const kept = new Set(data.nodes.filter((node) => allowed(node)
    && (!filters.status || (node.status ?? "unknown") === filters.status)
    && (!filters.machine || node.machineId === filters.machine)
    && words.every((word) => `${node.label}\n${node.detail ?? ""}`.toLocaleLowerCase().includes(word))).map((node) => node.id));
  const queue = [...kept];
  for (let at = 0; at < queue.length; at++) {
    for (const id of parents.get(queue[at]!) ?? []) {
      if (!kept.has(id) && allowed(byId.get(id)!)) { kept.add(id); queue.push(id); }
    }
  }
  return {
    nodes: data.nodes.filter((node) => kept.has(node.id)),
    edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    focusMissing: !!filters.focus && !byId.has(filters.focus) && !data.groups?.some((group) => group.id === filters.focus),
  };
}
