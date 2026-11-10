import { expect, test } from "bun:test";
import { graphAppearance, nodeRadius } from "./graphAppearance.ts";
import { projectGraph, type GraphData } from "./graphModel.ts";

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
  { id: "reply", source: "other", target: "agent", kind: "communication", evidence: "receipt" },
  { id: "second-peer", source: "checkout", target: "agent", kind: "communication", evidence: "receipt" },
  { id: "delegated", source: "checkout", target: "other", kind: "delegation", evidence: "receipt" },
  { id: "self", source: "repo", target: "repo", kind: "communication", evidence: "receipt" },
] };
test("radius counts distinct communication neighbours, excluding containment, delegation and self-links", () => {
  const style = graphAppearance(data);
  expect(style.get("repo")!.degree).toBe(0);
  expect(style.get("repo")!.radius).toBe(9);
  expect(style.get("checkout")!.degree).toBe(1);
  expect(style.get("other")!.degree).toBe(1);
  expect(style.get("agent")!.degree).toBe(2);
  expect(style.get("repo")!.radius).toBeLessThan(style.get("checkout")!.radius);
  expect(style.get("checkout")!.radius).toBeLessThan(style.get("agent")!.radius);
  expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(20));
});
test("hidden communication links do not contribute to radius", () => {
  const view = projectGraph(data, { search: "", status: "", machine: "", focus: "", showCompleted: true, communication: "none" });
  for (const style of graphAppearance(view).values()) {
    expect(style.degree).toBe(0);
    expect(style.radius).toBe(9);
  }
});
test("repository colour follows only physical containment, never communication", () => {
  const style = graphAppearance(data);
  expect(style.get("agent")!.colour).toBe(style.get("repo")!.colour);
  expect(style.get("checkout")!.colour).toBe(style.get("repo")!.colour);
  expect(style.get("other")!.colour).not.toBe(style.get("repo")!.colour);
  expect(graphAppearance({ ...data, nodes: [...data.nodes].reverse() }).get("agent")!.colour).toBe(style.get("agent")!.colour);
});
