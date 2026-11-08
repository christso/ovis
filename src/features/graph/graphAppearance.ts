import type { GraphData } from "./graphModel.ts";

export const nodeRadius = (degree: number) => 9 + Math.sqrt(Math.max(0, degree)) * 4;
export function repositoryColour(key: string): string {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `color-mix(in srgb, hsl(${((hash >>> 0) % 36000) / 100} 65% 52%) 70%, var(--text-strong))`;
}

export function graphAppearance(data: GraphData) {
  const neighbours = new Map(data.nodes.map((node) => [node.id, new Set<string>()]));
  const repositories = new Map<string, Set<string>>();
  for (const node of data.nodes) if (node.kind === "repository") repositories.set(node.id, new Set([node.repositoryKey ?? node.label]));
  for (const edge of data.edges) {
    if (edge.source !== edge.target) { neighbours.get(edge.source)?.add(edge.target); neighbours.get(edge.target)?.add(edge.source); }
  }
  const memberships = data.edges.filter((edge) => edge.kind !== "delegation" && edge.kind !== "communication" && edge.kind !== "work-session");
  for (let pass = 0; pass < data.nodes.length; pass++) {
    let changed = false;
    for (const edge of memberships) {
      const [child, parent] = edge.kind === "session-execution" ? [edge.target, edge.source] : [edge.source, edge.target];
      const inherited = repositories.get(parent);
      if (!inherited) continue;
      const keys = repositories.get(child) ?? new Set<string>();
      for (const key of inherited) if (!keys.has(key)) { keys.add(key); changed = true; }
      repositories.set(child, keys);
    }
    if (!changed) break;
  }
  return new Map(data.nodes.map((node) => {
    const keys = repositories.get(node.id), repository = keys?.size === 1 ? [...keys][0]! : null;
    const degree = neighbours.get(node.id)!.size;
    return [node.id, { degree, radius: nodeRadius(degree), repository, colour: repository ? repositoryColour(repository) : "var(--text-dim)" }];
  }));
}
