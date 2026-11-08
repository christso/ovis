import { expect, test } from "bun:test";
import { graphSimulation, simulationPositions } from "./graphSimulation.ts";
import type { GraphData } from "./graphModel.ts";
const data: GraphData = { nodes: [
  { id: "repo", kind: "repository", label: "Orchard" },
  { id: "checkout", kind: "checkout", label: "Branches" },
  { id: "agent", kind: "execution", label: "Prune" },
], edges: [
  { id: "a", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "inventory" },
  { id: "b", source: "agent", target: "checkout", kind: "execution-in-checkout", evidence: "inventory" },
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
