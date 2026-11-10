import { expect, test } from "bun:test";
import { graphSimulation, simulationPositions } from "./graphSimulation.ts";
import type { GraphData } from "./graphModel.ts";
const data: GraphData = { nodes: [
  { id: "repo", kind: "workspace", label: "Orchard" },
  { id: "checkout", kind: "worktree", label: "Branches" },
  { id: "agent", kind: "tab", label: "Prune" },
], edges: [
  { id: "a", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "inventory" },
  { id: "b", source: "agent", target: "checkout", kind: "tab-in-worktree", evidence: "inventory" },
] };
test("a dragged node pulls its linked neighbours and the released graph settles", () => {
  const force = graphSimulation(data, {}).tick(300);
  const nodes = force.nodes(), agent = nodes.find((node) => node.id === "agent")!;
  const before = simulationPositions(nodes);
  agent.fx = agent.x + 180; agent.fy = agent.y + 80;
  force.alpha(0.35).alphaTarget(0.12).tick(40);
  expect(Math.hypot(nodes[0]!.x - before[nodes[0]!.id]!.x, nodes[0]!.y - before[nodes[0]!.id]!.y)).toBeGreaterThan(10);
  agent.fx = null; agent.fy = null;
  force.alphaTarget(0).tick(300);
  expect(force.alpha()).toBeLessThan(force.alphaMin());
  const settled = simulationPositions(nodes);
  force.tick(50);
  for (const node of nodes) expect(Math.hypot(node.x - settled[node.id]!.x, node.y - settled[node.id]!.y)).toBeLessThan(0.01);
  force.stop();
});
test("parallel events do not multiply physical springs and reset is reproducible", () => {
  const first = graphSimulation(data, {}).tick(300);
  const duplicate = graphSimulation({ ...data, edges: [...data.edges, { ...data.edges[0]!, id: "parallel", eventCount: 9000 }] }, {}).tick(300);
  expect(simulationPositions(first.nodes())).toEqual(simulationPositions(duplicate.nodes()));
  expect(simulationPositions(graphSimulation(data, {}).tick(300).nodes())).toEqual(simulationPositions(first.nodes()));
  first.stop(); duplicate.stop();
});

test("workspace and worktree links cluster their tabs without repository-colour forces", () => {
  const nodes: GraphData["nodes"][number][] = [], edges: GraphData["edges"][number][] = [];
  for (const group of ["left", "right"]) {
    nodes.push({ id: group, kind: "workspace", label: group });
    nodes.push({ id: `${group}-branch`, kind: "worktree", label: "Feature" });
    edges.push({ id: `${group}-branch`, source: `${group}-branch`, target: group, kind: "worktree-in-workspace", evidence: "Herdr" });
    for (let i = 0; i < 6; i++) {
      const id = `${group}-${i}`; nodes.push({ id, kind: "tab", label: id });
      edges.push({ id, source: id, target: i % 2 ? `${group}-branch` : group, kind: i % 2 ? "tab-in-worktree" : "tab-in-workspace", evidence: "Herdr" });
    }
  }
  edges.push({ id: "message", source: "left-0", target: "right-0", kind: "communication", evidence: "receipt" });
  const force = graphSimulation({ nodes, edges }, {}).tick(300);
  const left = force.nodes().filter((node) => node.id.startsWith("left")), right = force.nodes().filter((node) => node.id.startsWith("right"));
  const center = (group: typeof left) => ({ x: group.reduce((sum, node) => sum + node.x, 0) / group.length, y: group.reduce((sum, node) => sum + node.y, 0) / group.length });
  const a = center(left), b = center(right), gap = Math.hypot(a.x - b.x, a.y - b.y);
  for (const [group, own] of [[left, a], [right, b]] as const) {
    const spread = group.reduce((sum, node) => sum + Math.hypot(node.x - own.x, node.y - own.y), 0) / group.length;
    expect(spread).toBeLessThan(gap * 0.6);
  }
  force.stop();
});
