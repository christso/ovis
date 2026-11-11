import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { graphAppearance } from "./graphAppearance.ts";
import { reconcilePositions, type Positions } from "./graphLayout.ts";
import type { GraphData } from "./graphModel.ts";

export interface ForceNode extends SimulationNodeDatum { id: string; x: number; y: number }
export function graphSimulation(data: GraphData, previous: Positions, groupMachine = false) {
  const positions = reconcilePositions(data.nodes, previous), styles = graphAppearance(data);
  const nodes: ForceNode[] = [...data.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => ({ id: node.id, ...positions[node.id]! }));
  const machines = [...new Set(data.nodes.map((node) => node.machineId ?? ""))].sort();
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const links = new Map<string, { source: string; target: string; hierarchy: boolean }>();
  for (const edge of data.edges) {
    const key = [edge.source, edge.target].sort().join("\0");
    const hierarchy = edge.kind !== "communication" && edge.kind !== "delegation";
    if (!links.has(key) || hierarchy) links.set(key, { source: edge.source, target: edge.target, hierarchy });
  }
  const children = new Set([...links.values()].filter((link) => link.hierarchy).map((link) => link.source));
  const roots = new Set(data.nodes.filter((node) => node.kind !== "tab" && !children.has(node.id)).map((node) => node.id));
  return forceSimulation(nodes).stop().alphaDecay(0.035).velocityDecay(0.38)
    .force("link", forceLink<ForceNode, { source: string; target: string; hierarchy: boolean }>([...links.values()]).id((node) => node.id).distance((link) => link.hierarchy ? 70 : 180).strength((link) => link.hierarchy ? 0.7 : 0.08))
    .force("charge", forceManyBody<ForceNode>().strength((node) => roots.has(node.id) ? -1200 : -160))
    .force("collision", forceCollide<ForceNode>().radius((node) => styles.get(node.id)!.radius + 18).iterations(2))
    .force("x", forceX<ForceNode>((node) => groupMachine ? (machines.indexOf(byId.get(node.id)?.machineId ?? "") - (machines.length - 1) / 2) * 300 : 0).strength(groupMachine ? 0.1 : 0.025))
    .force("y", forceY<ForceNode>(0).strength(0.025));
}
export const simulationPositions = (nodes: readonly ForceNode[]): Positions => Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
