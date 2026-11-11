import { describe, expect, it } from "bun:test";
import { projectGraph, type GraphData } from "./graphModel.ts";
import { reconcilePositions, fitGraph, zoomAt } from "./graphLayout.ts";
import { DEFAULT_GRAPH_STATE, graphLocation, readGraphLocation, sanitizeGraphState } from "./graphState.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "workspace", label: "Orchard" },
    { id: "checkout", kind: "worktree", label: "Garden", machineId: "north" },
    { id: "session", kind: "terminal", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "terminal", label: "Review branches", status: "working", machineId: "north", freshness: "live" },
    { id: "sibling", kind: "terminal", label: "Other task" },
    { id: "sibling-execution", kind: "terminal", label: "Other task" },
    { id: "done", kind: "terminal", label: "Harvest", status: "done", freshness: "stale" },
    { id: "unrelated", kind: "terminal", label: "Garden", freshness: "disconnected" },
  ],
  edges: [
    { id: "a", source: "execution", target: "checkout", kind: "terminal-in-worktree", evidence: "reported checkout" },
    { id: "b", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "reported repository" },
    { id: "c", source: "session", target: "checkout", kind: "terminal-in-worktree", evidence: "recorded tab" },
    { id: "d", source: "sibling", target: "repo", kind: "terminal-in-workspace", evidence: "recorded tab" },
    { id: "e", source: "sibling-execution", target: "checkout", kind: "terminal-in-worktree", evidence: "recorded checkout" },
    { id: "dangling", source: "missing", target: "repo", kind: "delegation", evidence: "recorded parent" },
    { id: "unsupported", source: "unrelated", target: "repo", kind: "delegation", evidence: "" },
  ],
};

describe("Graph projection", () => {
  it("hides node types and their incident links without reconnecting children", () => {
    const view = projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["worktree"] });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "session", "execution", "sibling", "sibling-execution", "unrelated"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["d"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["workspace"] }).edges.map((edge) => edge.id)).toEqual(["a", "c", "e"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["terminal"] }).edges.map((edge) => edge.id)).toEqual(["b"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["workspace", "worktree", "terminal"] }).nodes).toEqual([]);
    expect(projectGraph(fixture, DEFAULT_GRAPH_STATE.filters).edges.map((edge) => edge.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("never reintroduces hidden ancestors for matching or focused tabs", () => {
    const filters = { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["worktree" as const] };
    expect(projectGraph(fixture, { ...filters, search: "prune" }).nodes.map((node) => node.id)).toEqual(["session"]);
    const focused = projectGraph(fixture, { ...filters, focus: "repo" });
    expect(focused.nodes.some((node) => node.kind === "worktree")).toBe(false);
    expect(focused.nodes.some((node) => node.id === "session")).toBe(true);
    expect(focused.edges.map((edge) => edge.id)).toEqual(["d"]);
  });
  it("filters communication by recent activity without treating messages as containment", () => {
    const now = Date.parse("2026-11-08T00:00:00Z");
    const data = { ...fixture, edges: [...fixture.edges,
      { id: "recent", kind: "communication" as const, source: "session", target: "unrelated", evidence: "codex receipt", lastObservedAt: "2026-11-07T23:00:00Z" },
      { id: "old", kind: "communication" as const, source: "session", target: "sibling", evidence: "codex receipt", lastObservedAt: "2026-11-01T00:00:00Z" }] };
    expect(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, communication: "recent" }, now).edges.some((edge) => edge.id === "old")).toBe(false);
    expect(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, communication: "all" }, now).edges.some((edge) => edge.id === "old")).toBe(true);
    expect(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, communication: "none" }, now).edges.some((edge) => edge.kind === "communication")).toBe(false);
    expect(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, focus: "session", communication: "recent" }, now).nodes.map((node) => node.id)).toContain("unrelated");
  });
  it("draws only evidenced typed links with known endpoints, never links equal labels", () => {
    const view = projectGraph(fixture, DEFAULT_GRAPH_STATE.filters);
    expect(view.edges.map((edge) => edge.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(view.nodes.some((node) => node.id === "unrelated")).toBe(true);
    expect(view.nodes.some((node) => node.id === "done")).toBe(false);
  });
  it("keeps workspace context for a matching tab and focuses using established edges", () => {
    const view = projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, search: "prune", machine: "north" });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "repo" }).nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session", "execution", "sibling", "sibling-execution"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "unrelated" }).nodes.map((node) => node.id)).toEqual(["unrelated"]);
  });
  it("tab focus includes its worktree and workspace but excludes sibling tabs", () => {
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, focus: "session" }).nodes.map((node) => node.id)).toEqual(["repo", "checkout", "session"]);
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
    changed.push({ id: "new", kind: "terminal", label: "New growth" });
    const next = reconcilePositions(changed, positions);
    expect(next.session).toEqual(positions.session);
    expect(reconcilePositions(changed.slice(0, 1), next).session).toEqual(positions.session);
    expect(new Set(Object.values(next).map((p) => `${p.x},${p.y}`)).size).toBe(Object.keys(next).length);
  });
});

describe("Graph location and viewport", () => {
  it("round trips selection, filters and optional grouping without changing unrelated URL state", () => {
    const state = { ...DEFAULT_GRAPH_STATE, selected: `terminal:${"split-pane/native-identity /?&".repeat(100)}`, filters: { ...DEFAULT_GRAPH_STATE.filters, search: "tree & leaf", focus: "repo", machine: "north", status: "blocked", showCompleted: true, communication: "all" as const, hiddenKinds: ["worktree" as const] }, groupMachine: true };
    const url = graphLocation(new URL("https://ovis.invalid/?view=graph&pane=w7%3Ap2"), state);
    expect(readGraphLocation(url, DEFAULT_GRAPH_STATE)).toEqual(state);
    expect(url.searchParams.get("pane")).toBe("w7:p2");
  });
  it("bounds stored values and ignores malformed positions and unknown versions", () => {
    expect(sanitizeGraphState({ version: 99, selected: "future" })).toBeNull();
    expect(sanitizeGraphState({ version: 3, layout: "future" })).toBeNull();
    const state = sanitizeGraphState({ version: 3, viewport: { x: 0, y: 0, k: 999 }, positions: { bad: { x: Infinity, y: 2 }, fine: { x: 5, y: 7 } } })!;
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
