import type { GraphData, GraphKind } from "./graphModel.ts";

export const nodeRadius = (degree: number) => 9 + Math.sqrt(Math.max(0, degree)) * 4;
export function machineColour(key: string): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `color-mix(in srgb, hsl(${((hash >>> 0) % 36000) / 100} 65% 52%) 70%, var(--text-strong))`;
}

const NODE_COLOURS: Record<GraphKind, string> = {
  workspace: "var(--syntax-string)", worktree: "var(--syntax-number)", tab: "color-mix(in srgb, var(--syntax-type) 60%, var(--syntax-string))",
};
export const graphNodeColour = (kind: GraphKind): string => `color-mix(in srgb, ${NODE_COLOURS[kind]} 70%, var(--text-strong))`;

export function graphAppearance(data: GraphData) {
  const neighbours = new Map(data.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of data.edges) {
    if (edge.kind === "communication" && edge.source !== edge.target) { neighbours.get(edge.source)?.add(edge.target); neighbours.get(edge.target)?.add(edge.source); }
  }
  return new Map(data.nodes.map((node) => {
    const degree = neighbours.get(node.id)!.size;
    return [node.id, { degree, radius: nodeRadius(degree), colour: graphNodeColour(node.kind) }];
  }));
}
