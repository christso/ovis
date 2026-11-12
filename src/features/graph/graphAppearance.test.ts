import { expect, test } from "bun:test";
import { graphAppearance, graphNodeColour, nodeRadius } from "./graphAppearance.ts";
import { graphNodeIsWorking, projectGraph, type GraphData } from "./graphModel.ts";

const data: GraphData = { nodes: [
  { id: "repo", kind: "repository", label: "Orchard" },
  { id: "empty", kind: "repository", label: "Empty" },
  { id: "one", kind: "terminal", label: "Build", status: "working", freshness: "live" },
  { id: "two", kind: "terminal", label: "Test", status: "blocked", freshness: "live" },
], edges: [
  { id: "a", source: "one", target: "repo", kind: "terminal-in-repository", evidence: "Git" },
  { id: "b", source: "two", target: "repo", kind: "terminal-in-repository", evidence: "Git" },
  { id: "c", source: "one", target: "two", kind: "communication", evidence: "Herdr", eventCount: 999 },
  { id: "d", source: "two", target: "one", kind: "communication", evidence: "Herdr" },
  { id: "self", source: "repo", target: "repo", kind: "communication", evidence: "Herdr" },
] };
test("radius counts distinct connections without receipt, parallel or self-link inflation", () => {
  const style = graphAppearance(data);
  expect(style.get("empty")!.degree).toBe(0); expect(style.get("empty")!.radius).toBe(6);
  for (const id of ["repo", "one", "two"]) expect(style.get(id)!.degree).toBe(2);
  expect(nodeRadius(5) / nodeRadius(1)).toBeGreaterThanOrEqual(1.7);
  expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(20)); expect(nodeRadius(10000)).toBe(nodeRadius(114));
  const view = projectGraph(data, { search: "", status: "", machine: "", focus: "", showCompleted: true, communication: "none" });
  expect(graphAppearance(view).get("one")!.degree).toBe(1);
});
test("hubs stay neutral in every status and terminal colour follows authoritative freshness", () => {
  const neutral = "var(--text-dim)";
  for (const status of ["working", "waiting", "blocked", "done", "idle", "unknown"] as const) {
    expect(graphNodeColour({ kind: "repository", status, freshness: "live" })).toBe("var(--graph-repository)");
    expect(graphNodeIsWorking({ id: "hub", kind: "repository", label: "Hub", status, hasWorkingTerminals: true })).toBe(false);
    for (const freshness of ["stale", "disconnected", "unavailable", "unsupported"] as const) {
      expect(graphNodeColour({ kind: "terminal", status, freshness })).toBe(neutral);
      expect(graphNodeIsWorking({ id: "term", kind: "terminal", label: "Term", status, freshness })).toBe(false);
    }
  }
  for (const [status, token] of [["working", "working"], ["waiting", "working"], ["blocked", "blocked"], ["done", "done"]] as const) expect(graphNodeColour({ kind: "terminal", status, freshness: "live" })).toBe(`var(--status-${token})`);
  expect(graphNodeColour({ kind: "terminal", status: "idle" })).toBe(neutral);
  expect(graphNodeIsWorking({ id: "term", kind: "terminal", label: "Term", status: "working", freshness: "live" })).toBe(true);
});
