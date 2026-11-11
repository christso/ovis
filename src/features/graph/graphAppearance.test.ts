import { expect, test } from "bun:test";
import { graphAppearance, nodeRadius } from "./graphAppearance.ts";
import { projectGraph, type GraphData } from "./graphModel.ts";

const data: GraphData = { nodes: [
  { id: "repo", kind: "workspace", label: "Orchard", repositoryKey: "Orchard" },
  { id: "checkout", kind: "worktree", label: "Feature" },
  { id: "agent", kind: "terminal", label: "Prune" },
  { id: "other", kind: "workspace", label: "Harbour", repositoryKey: "Harbour" },
  { id: "root-tab", kind: "terminal", label: "Notes" },
  { id: "empty", kind: "workspace", label: "Empty" },
], edges: [
  { id: "direct", source: "root-tab", target: "repo", kind: "terminal-in-workspace", evidence: "inventory" },
  { id: "a", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "inventory" },
  { id: "b", source: "agent", target: "checkout", kind: "terminal-in-worktree", evidence: "inventory" },
  { id: "parallel", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "inventory", eventCount: 999 },
  { id: "message", source: "agent", target: "other", kind: "communication", evidence: "receipt", eventCount: 999 },
  { id: "reply", source: "other", target: "agent", kind: "communication", evidence: "receipt" },
  { id: "second-peer", source: "checkout", target: "agent", kind: "communication", evidence: "receipt" },
  { id: "delegated", source: "checkout", target: "other", kind: "delegation", evidence: "receipt" },
  { id: "self", source: "repo", target: "repo", kind: "communication", evidence: "receipt" },
] };
test("radius counts all distinct connections, excluding parallel edges, receipts and self-links", () => {
  const style = graphAppearance(data);
  expect(style.get("empty")!.degree).toBe(0);
  expect(style.get("empty")!.radius).toBe(6);
  expect(style.get("root-tab")!.degree).toBe(1);
  expect(style.get("repo")!.degree).toBe(2);
  expect(style.get("checkout")!.degree).toBe(3);
  expect(style.get("other")!.degree).toBe(2);
  expect(style.get("agent")!.degree).toBe(2);
  expect(style.get("empty")!.radius).toBeLessThan(style.get("root-tab")!.radius);
  expect(style.get("root-tab")!.radius).toBeLessThan(style.get("repo")!.radius);
  expect(style.get("repo")!.radius).toBeLessThan(style.get("checkout")!.radius);
  expect(style.get("other")!.radius).toBe(style.get("agent")!.radius);
  expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(20));
});
test("Folio-style growth makes a five-link hub visibly larger and bounds crowded hubs", () => {
  expect(nodeRadius(5) / nodeRadius(1)).toBeGreaterThanOrEqual(1.7);
  expect((nodeRadius(5) / nodeRadius(1)) ** 2).toBeGreaterThanOrEqual(3);
  expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
  expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(20));
  expect(nodeRadius(10_000)).toBe(nodeRadius(114));
});
test("hidden communication links leave hierarchy and delegation connections in the radius", () => {
  const view = projectGraph(data, { search: "", status: "", machine: "", focus: "", showCompleted: true, communication: "none" });
  const style = graphAppearance(view);
  expect(style.get("repo")!.degree).toBe(2);
  expect(style.get("checkout")!.degree).toBe(3);
  expect(style.get("agent")!.degree).toBe(1);
  expect(style.get("other")!.degree).toBe(1);
  expect(style.get("agent")!.radius).toBeLessThan(graphAppearance(data).get("agent")!.radius);
});
test("node colours identify workspace, worktree and tab kinds regardless of repository", () => {
  const nodes: GraphData["nodes"] = [
    { id: "workspace-a", kind: "workspace", label: "Orchard", repositoryKey: "apple" },
    { id: "workspace-b", kind: "workspace", label: "Harbour", repositoryKey: "pear" },
    { id: "worktree", kind: "worktree", label: "Feature", repositoryKey: "apple" },
    { id: "tab-a", kind: "terminal", label: "Code", repositoryKey: "apple" },
    { id: "tab-b", kind: "terminal", label: "Notes" },
    { id: "terminal", kind: "terminal", label: "Shell" },
  ];
  const style = graphAppearance({ nodes, edges: [] });
  expect(style.get("workspace-a")!.colour).toBe(style.get("workspace-b")!.colour);
  expect(style.get("tab-a")!.colour).toBe(style.get("tab-b")!.colour);
  expect(new Set([style.get("workspace-a")!.colour, style.get("worktree")!.colour, style.get("tab-a")!.colour]).size).toBe(3);
  expect(new Set([...style.values()].map((node) => node.colour)).size).toBe(3);
});
test("every split terminal contributes a direct workspace connection", () => {
  const detail: GraphData = { nodes: [...data.nodes, { id: "split", kind: "terminal", label: "Shell" }],
    edges: [...data.edges, { id: "split-parent", source: "split", target: "repo", kind: "terminal-in-workspace", evidence: "Herdr" }] };
  const filters = { search: "", status: "", machine: "", focus: "", showCompleted: true, communication: "all" as const };
  const visible = graphAppearance(projectGraph(detail, filters));
  expect(visible.get("repo")!.degree).toBe(3);
  expect(visible.get("split")!.degree).toBe(1);
  expect(visible.get("repo")!.radius).toBeGreaterThan(visible.get("split")!.radius);
  const hidden = projectGraph(detail, { ...filters, hiddenKinds: ["terminal"] });
  expect(hidden.nodes.some((node) => node.kind === "terminal")).toBe(false);
  expect(hidden.edges.some((edge) => edge.kind === "terminal-in-workspace")).toBe(false);
});
