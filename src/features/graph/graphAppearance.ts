import type { GraphData, GraphKind } from "./graphModel.ts";

// Folio's capped square-root curve, tuned for stronger contrast between small hubs.
export const nodeRadius = (degree: number) => 6 + 6 * Math.min(16, 1.5 * Math.sqrt(Math.max(0, degree)));
export function machineColour(key: string): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `color-mix(in srgb, hsl(${((hash >>> 0) % 36000) / 100} 65% 52%) 70%, var(--text-strong))`;
}

const NODE_COLOURS: Record<GraphKind, string> = {
  workspace: "var(--graph-workspace)", worktree: "var(--graph-worktree)", tab: "var(--graph-tab)",
};
export const graphNodeColour = (kind: GraphKind): string => NODE_COLOURS[kind];

export function graphAppearance(data: GraphData) {
  const neighbours = new Map(data.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of data.edges) {
    if (edge.source !== edge.target) { neighbours.get(edge.source)?.add(edge.target); neighbours.get(edge.target)?.add(edge.source); }
  }
  return new Map(data.nodes.map((node) => {
    const degree = neighbours.get(node.id)!.size;
    return [node.id, { degree, radius: nodeRadius(degree), colour: graphNodeColour(node.kind) }];
  }));
}
