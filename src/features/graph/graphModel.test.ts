import { expect, test } from "bun:test";
import { projectGraph, type GraphData } from "./graphModel.ts";
import { reconcilePositions, fitGraph, zoomAt } from "./graphLayout.ts";
import { DEFAULT_GRAPH_STATE, graphLocation, readGraphLocation, sanitizeGraphState } from "./graphState.ts";

const data: GraphData = { nodes: [
  { id: "repo", kind: "repository", label: "Orchard" },
  { id: "other", kind: "repository", label: "Harbour" },
  { id: "one", kind: "terminal", label: "Build", status: "working", machineId: "north", freshness: "live" },
  { id: "two", kind: "terminal", label: "Review", status: "done", machineId: "south", freshness: "live" },
  { id: "three", kind: "terminal", label: "Test", status: "idle", machineId: "south" },
], edges: [
  { id: "a", source: "one", target: "repo", kind: "terminal-in-repository", evidence: "Git remote" },
  { id: "b", source: "two", target: "repo", kind: "terminal-in-repository", evidence: "Git remote" },
  { id: "c", source: "three", target: "other", kind: "terminal-in-repository", evidence: "Local Git" },
  { id: "same-repo", source: "one", target: "two", kind: "communication", evidence: "Herdr", sources: ["herdr"], eventCount: 2, lastObservedAt: "2026-11-12T01:00:00Z" },
  { id: "message-1", source: "one", target: "three", kind: "communication", evidence: "Herdr", sources: ["herdr"], eventCount: 3, lastObservedAt: "2026-11-12T01:00:00Z" },
  { id: "message-2", source: "two", target: "three", kind: "communication", evidence: "Codex", sources: ["codex"], eventCount: 4, lastObservedAt: "2026-11-12T02:00:00Z" },
  { id: "reply", source: "three", target: "one", kind: "communication", evidence: "CLI", sources: ["herdr-cli"], eventCount: 1, lastObservedAt: "2026-11-12T01:00:00Z" },
  { id: "delegate", source: "one", target: "three", kind: "delegation", evidence: "Herdr", sources: ["herdr"], eventCount: 1, lastObservedAt: "2026-11-12T01:00:00Z" },
] };
const filters = { ...DEFAULT_GRAPH_STATE.filters, showCompleted: true, communication: "all" as const };
test("both visibility kinds preserve direction and aggregate receipts without self links", () => {
  for (let mask = 0; mask < 4; mask++) {
    const hiddenKinds = (["repository", "terminal"] as const).filter((_, index) => !(mask & 1 << index));
    const view = projectGraph(data, { ...filters, hiddenKinds });
    expect(view.nodes.filter((node) => node.kind === "repository")).toHaveLength(mask & 1 ? 2 : 0);
    expect(view.nodes.filter((node) => node.kind === "terminal")).toHaveLength(mask & 2 ? 3 : 0);
    expect(view.edges.every((edge) => edge.source !== edge.target)).toBe(true);
    if (mask === 1) {
      expect(view.edges.find((edge) => edge.kind === "communication" && edge.source === "repo")).toMatchObject({ source: "repo", target: "other", eventCount: 7, lastObservedAt: "2026-11-12T02:00:00Z", sources: ["codex", "herdr"] });
      expect(view.edges.find((edge) => edge.kind === "communication" && edge.source === "other")).toMatchObject({ target: "repo", eventCount: 1 });
      expect(view.edges.find((edge) => edge.kind === "delegation")).toMatchObject({ eventCount: 1 });
    }
    if (mask === 3) expect(view.edges.find((edge) => edge.id === "same-repo")).toMatchObject({ source: "one", target: "two", eventCount: 2 });
  }
});
test("machine, status, search and completed filters retain shared ancestry without unrelated terminals", () => {
  for (const patch of [{ machine: "north" }, { status: "working" }, { search: "Build" }, { showCompleted: false, machine: "north" }]) {
    const view = projectGraph(data, { ...filters, ...patch });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "one"]);
  }
  const completed = projectGraph(data, { ...filters, showCompleted: false });
  expect(completed.nodes.some((node) => node.id === "two")).toBe(false);
  expect(completed.edges.some((edge) => edge.id === "same-repo")).toBe(false);
});
test("focus on a hidden terminal retains only its own receipt evidence", () => {
  const view = projectGraph(data, { ...filters, focus: "one", hiddenKinds: ["terminal"] });
  expect(view.edges.find((edge) => edge.source === "repo" && edge.kind === "communication")?.eventCount).toBe(3);
  expect(view.edges.find((edge) => edge.source === "other" && edge.kind === "communication")?.eventCount).toBe(1);
  const group = { id: 'workspace:["north","w1"]', label: "Legacy checkout", machineId: "north", nodeIds: ["one"] };
  const focused = projectGraph({ ...data, groups: [group] }, { ...filters, focus: group.id });
  expect(focused.nodes.map((node) => node.id)).toEqual(["repo", "other", "one", "two", "three"]);
  expect(projectGraph(data, { ...filters, focus: "missing" }).focusMissing).toBe(true);
});
test("communication windows, deduplication and missing endpoints never fabricate evidence", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const invalid: GraphData = { ...data, edges: [...data.edges, data.edges[4]!, { ...data.edges[4]!, id: "old", lastObservedAt: "2020-01-01T00:00:00Z" }, { ...data.edges[4]!, id: "missing", target: "absent" }, { ...data.edges[4]!, id: "blank", evidence: " " }] };
  expect(projectGraph(invalid, { ...filters, communication: "recent" }, now).edges.filter((edge) => edge.kind === "communication")).toHaveLength(4);
  expect(projectGraph(invalid, { ...filters, communication: "none" }, now).edges.filter((edge) => edge.kind === "communication")).toHaveLength(0);
  expect(projectGraph(invalid, { ...filters, communication: "none" }, now).edges.some((edge) => edge.kind === "delegation")).toBe(true);
});
test("URL round-trip owns only graph fields and safely bounds stored geometry", () => {
  const state = { ...DEFAULT_GRAPH_STATE, selected: "terminal:exact", groupMachine: true, filters: { ...filters, focus: "repo", search: "a b", hiddenKinds: ["terminal" as const] } };
  const url = graphLocation(new URL("https://ovis.invalid/?pane=p1&machine=north&view=terminal&other=keep"), state);
  expect(readGraphLocation(url, DEFAULT_GRAPH_STATE)).toEqual(state);
  expect(url.searchParams.get("pane")).toBe("p1"); expect(url.searchParams.get("other")).toBe("keep");
  expect(sanitizeGraphState({ ...state, version: 99 })).toBeNull();
  const bounded = sanitizeGraphState({ ...state, viewport: { x: Infinity, y: -1e9, k: 99 }, positions: { bad: { x: NaN, y: 1 }, good: { x: 1, y: 2 } } })!;
  expect(bounded.viewport).toEqual({ x: 160, y: -1e6, k: 4 }); expect(bounded.positions).toEqual({ good: { x: 1, y: 2 } });
});
test("layout retains positions, fits empty and nonempty graphs and anchors zoom", () => {
  const positions = reconcilePositions(data.nodes, { one: { x: 17, y: 29 } });
  expect(positions.one).toEqual({ x: 17, y: 29 }); expect(Object.keys(positions)).toHaveLength(5);
  expect(Object.values(fitGraph([], 320, 500)).every(Number.isFinite)).toBe(true);
  expect(fitGraph([{ x: -50, y: -50 }, { x: 50, y: 50 }], 320, 500).k).toBeGreaterThan(0);
  expect(zoomAt({ x: 10, y: 20, k: 1 }, 2, 110, 120)).toEqual({ x: -90, y: -80, k: 2 });
});
