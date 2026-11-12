import type { GraphData, GraphNode } from "./graphModel.ts";

// Folio's capped square-root curve, tuned for stronger contrast between small hubs.
export const nodeRadius = (degree: number) => 6 + 6 * Math.min(16, 1.5 * Math.sqrt(Math.max(0, degree)));
export function machineColour(key: string): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `color-mix(in srgb, hsl(${((hash >>> 0) % 36000) / 100} 65% 52%) 70%, var(--text-strong))`;
}

export function graphNodeColour(node: Pick<GraphNode, "kind" | "status" | "freshness">): string {
  if (node.kind === "repository") return "var(--graph-repository)";
  if (node.freshness && node.freshness !== "live") return "var(--text-dim)";
  switch (node.status) {
    case "working": case "waiting": return "var(--status-working)";
    case "blocked": return "var(--status-blocked)";
    case "done": return "var(--status-done)";
    default: return "var(--text-dim)";
  }
}

export function graphAppearance(data: GraphData) {
  const neighbours = new Map(data.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of data.edges) {
    if (edge.source !== edge.target) { neighbours.get(edge.source)?.add(edge.target); neighbours.get(edge.target)?.add(edge.source); }
  }
  return new Map(data.nodes.map((node) => {
    const degree = neighbours.get(node.id)!.size;
    return [node.id, { degree, radius: nodeRadius(degree), colour: graphNodeColour(node) }];
  }));
}
