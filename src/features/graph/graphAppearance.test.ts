import { expect, test } from "bun:test";
import { graphAppearance, nodeRadius } from "./graphAppearance.ts";
import type { GraphData } from "./graphModel.ts";

const data: GraphData = { nodes: [
  { id: "repo", kind: "repository", label: "Orchard", repositoryKey: "Orchard" },
  { id: "checkout", kind: "checkout", label: "Feature" },
  { id: "agent", kind: "execution", label: "Prune" },
  { id: "other", kind: "repository", label: "Harbour", repositoryKey: "Harbour" },
], edges: [
  { id: "a", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "inventory" },
  { id: "b", source: "agent", target: "checkout", kind: "execution-in-checkout", evidence: "inventory" },
  { id: "parallel", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "inventory", eventCount: 999 },
  { id: "message", source: "agent", target: "other", kind: "communication", evidence: "receipt", eventCount: 999 },
] };
test("radius counts distinct visible neighbours and grows monotonically", () => {
  const style = graphAppearance(data);
  expect(style.get("repo")!.degree).toBe(1);
  expect(style.get("checkout")!.degree).toBe(2);
  expect(style.get("repo")!.radius).toBeLessThan(style.get("checkout")!.radius);
  expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(20));
});
test("repository colour follows only physical containment, never communication", () => {
  const style = graphAppearance(data);
  expect(style.get("agent")!.colour).toBe(style.get("repo")!.colour);
  expect(style.get("checkout")!.colour).toBe(style.get("repo")!.colour);
  expect(style.get("other")!.colour).not.toBe(style.get("repo")!.colour);
  expect(graphAppearance({ ...data, nodes: [...data.nodes].reverse() }).get("agent")!.colour).toBe(style.get("agent")!.colour);
});
