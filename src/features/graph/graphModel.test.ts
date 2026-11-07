import { describe, expect, it } from "bun:test";
import { projectGraph, type GraphData } from "./graphModel.ts";
import { reconcilePositions, fitGraph, zoomAt } from "./graphLayout.ts";
import { DEFAULT_GRAPH_STATE, graphLocation, readGraphLocation, sanitizeGraphState } from "./graphState.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "repository", label: "Orchard" },
    { id: "checkout", kind: "checkout", label: "Garden", machineId: "north" },
    { id: "session", kind: "session", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "execution", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "sibling", kind: "session", label: "Other task" },
    { id: "sibling-execution", kind: "execution", label: "Other task" },
    { id: "done", kind: "session", label: "Harvest", status: "done", freshness: "stale" },
    { id: "unrelated", kind: "session", label: "Garden", freshness: "disconnected" },
  ],
  edges: [
    { id: "a", source: "execution", target: "checkout", kind: "execution-in-checkout", evidence: "reported checkout" },
    { id: "b", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "reported repository" },
    { id: "c", source: "execution", target: "session", kind: "session-execution", evidence: "recorded session" },
    { id: "d", source: "sibling-execution", target: "sibling", kind: "session-execution", evidence: "recorded session" },
    { id: "e", source: "sibling-execution", target: "checkout", kind: "execution-in-checkout", evidence: "recorded checkout" },
    { id: "dangling", source: "missing", target: "repo", kind: "delegation", evidence: "recorded parent" },
    { id: "unsupported", source: "unrelated", target: "repo", kind: "delegation", evidence: "" },
  ],
};

describe("Graph projection", () => {
  it("draws only evidenced typed links with known endpoints, never links equal labels", () => {
    const view = projectGraph(fixture, DEFAULT_GRAPH_STATE.filters);
    expect(view.edges.map((edge) => edge.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(view.nodes.some((node) => node.id === "unrelated")).toBe(true);
    expect(view.nodes.some((node) => node.id === "done")).toBe(false);
  });
  it("keeps repository context for a matching session and focuses using established edges", () => {
    const view = projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, search: "prune", machine: "north" });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session", "execution"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "repo" }).nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session", "execution", "sibling", "sibling-execution"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "unrelated" }).nodes.map((node) => node.id)).toEqual(["unrelated"]);
  });
  it("session focus includes recorded execution/checkout/repository but excludes siblings", () => {
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "session" }).nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session", "execution"]);
  });
  it("treats unknown focus as unavailable instead of silently showing another target", () => {
    const view = projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "gone" });
    expect(view.nodes).toEqual([]);
    expect(view.focusMissing).toBe(true);
  });
  it("keeps a logical ID and position through roster changes, migration, filtering and addition", () => {
    const positions = reconcilePositions(fixture.nodes, {});
    const changed = fixture.nodes.map((node) => node.id === "session" ? { ...node, status: "blocked" as const, machineId: "south" } : node);
    changed.reverse();
    changed.push({ id: "new", kind: "session", label: "New growth" });
    const next = reconcilePositions(changed, positions);
    expect(next.session).toEqual(positions.session);
    expect(reconcilePositions(changed.slice(0, 1), next).session).toEqual(positions.session);
    expect(new Set(Object.values(next).map((p) => `${p.x},${p.y}`)).size).toBe(Object.keys(next).length);
  });
});

describe("Graph location and viewport", () => {
  it("round trips selection, filters and optional grouping without changing unrelated URL state", () => {
    const state = { ...DEFAULT_GRAPH_STATE, selected: "session:special /?&", filters: { ...DEFAULT_GRAPH_STATE.filters, search: "tree & leaf", focus: "repo", machine: "north", status: "blocked", showCompleted: true }, groupMachine: true };
    const url = graphLocation(new URL("https://ovis.invalid/?view=graph&pane=w7%3Ap2"), state);
    expect(readGraphLocation(url, DEFAULT_GRAPH_STATE)).toEqual(state);
    expect(url.searchParams.get("pane")).toBe("w7:p2");
  });
  it("bounds stored values and ignores malformed positions and unknown versions", () => {
    expect(sanitizeGraphState({ version: 99, selected: "future" })).toBeNull();
    const state = sanitizeGraphState({ version: 1, viewport: { x: 0, y: 0, k: 999 }, positions: { bad: { x: Infinity, y: 2 }, fine: { x: 5, y: 7 } } })!;
    expect(state.viewport.k).toBe(4);
    expect(state.positions).toEqual({ fine: { x: 5, y: 7 } });
  });
  it("fits and zooms around the pointer without losing its world coordinate", () => {
    const viewport = fitGraph([{ x: 0, y: 0 }, { x: 1000, y: 500 }], 800, 600);
    expect(viewport.k).toBeGreaterThan(0);
    const next = zoomAt(viewport, 2, 300, 200);
    expect((300 - next.x) / next.k).toBeCloseTo((300 - viewport.x) / viewport.k);
    expect((200 - next.y) / next.k).toBeCloseTo((200 - viewport.y) / viewport.k);
  });
});
