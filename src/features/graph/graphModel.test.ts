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
  it("projects containment past hidden node types", () => {
    const view = projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["worktree"] });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "session", "execution", "sibling", "sibling-execution", "unrelated"]);
    expect(view.edges.map((edge) => [edge.source, edge.target])).toEqual([["execution", "repo"], ["session", "repo"], ["sibling", "repo"], ["sibling-execution", "repo"]]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["workspace"] }).edges.map((edge) => edge.id)).toEqual(["a", "c", "e"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["terminal"] }).edges.map((edge) => edge.id)).toEqual(["b"]);
    expect(projectGraph(fixture, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["workspace", "worktree", "terminal"] }).nodes).toEqual([]);
    expect(projectGraph(fixture, DEFAULT_GRAPH_STATE.filters).edges.map((edge) => edge.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("retains visible ancestors through hidden levels for matching and focused terminals", () => {
    const filters = { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: ["worktree" as const] };
    expect(projectGraph(fixture, { ...filters, search: "prune" }).nodes.map((node) => node.id)).toEqual(["repo", "session"]);
    const focused = projectGraph(fixture, { ...filters, focus: "repo" });
    expect(focused.nodes.some((node) => node.kind === "worktree")).toBe(false);
    expect(focused.nodes.some((node) => node.id === "session")).toBe(true);
    expect(focused.edges).toHaveLength(4);
  });
  it("keeps an active Done workspace in the working filter when terminals are hidden", () => {
    const data: GraphData = { ...fixture, nodes: fixture.nodes.map((node) => node.id === "repo" ? { ...node, status: "done", hasWorkingTerminals: true } : node) };
    const view = projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, status: "working", hiddenKinds: ["terminal"] });
    expect(view.nodes.map((node) => node.id)).toEqual(["repo", "checkout"]);
    expect(view.nodes[0]!.status).toBe("done");
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


describe("visibility and recorded relationship projection", () => {
  const data: GraphData = {
    nodes: [
      { id: "w1", kind: "workspace", label: "Project", machineId: "one" },
      { id: "w2", kind: "workspace", label: "Project", machineId: "two" },
      { id: "c1", kind: "worktree", label: "Main checkout", machineId: "one" },
      { id: "c2", kind: "worktree", label: "Feature", machineId: "two" },
      { id: "t1", kind: "terminal", label: "Build", status: "working", machineId: "one" },
      { id: "t2", kind: "terminal", label: "Review", status: "working", machineId: "two" },
      { id: "t3", kind: "terminal", label: "Test", status: "done", machineId: "one" },
    ],
    edges: [
      { id: "c1w1", source: "c1", target: "w1", kind: "worktree-in-workspace", evidence: "Herdr" },
      { id: "c2w2", source: "c2", target: "w2", kind: "worktree-in-workspace", evidence: "Herdr" },
      { id: "t1c1", source: "t1", target: "c1", kind: "terminal-in-worktree", evidence: "Herdr" },
      { id: "t2c2", source: "t2", target: "c2", kind: "terminal-in-worktree", evidence: "Herdr" },
      { id: "t3c1", source: "t3", target: "c1", kind: "terminal-in-worktree", evidence: "Herdr" },
      { id: "m1", source: "t1", target: "t2", kind: "communication", evidence: "codex.communication", eventCount: 2, lastObservedAt: "2026-11-11T01:00:00Z", sources: ["codex"] },
      { id: "m2", source: "t3", target: "t2", kind: "communication", evidence: "herdr.communication", eventCount: 3, lastObservedAt: "2026-11-12T01:00:00Z", sources: ["herdr"] },
      { id: "reply", source: "t2", target: "t1", kind: "communication", evidence: "herdr-cli.communication", eventCount: 1, lastObservedAt: "2026-11-12T02:00:00Z", sources: ["herdr-cli"] },
      { id: "launch", source: "t1", target: "t2", kind: "delegation", evidence: "herdr.delegation", eventCount: 1, lastObservedAt: "2026-11-10T01:00:00Z", sources: ["herdr"] },
      { id: "internal", source: "t1", target: "t3", kind: "communication", evidence: "codex.communication", eventCount: 4, lastObservedAt: "2026-11-12T01:00:00Z", sources: ["codex"] },
    ],
  };
  const filters = { ...DEFAULT_GRAPH_STATE.filters, showCompleted: true, communication: "all" as const };
  const pairs = (graph: GraphData) => graph.edges.filter((edge) => edge.kind === "communication").map((edge) => `${edge.source}>${edge.target}:${edge.eventCount}`).sort();
  for (let mask = 0; mask < 8; mask++) {
    it(`projects the exact visibility mask ${mask}`, () => {
      const hiddenKinds = (["workspace", "worktree", "terminal"] as const).filter((_, index) => !(mask & (1 << index)));
      const view = projectGraph(data, { ...filters, hiddenKinds });
      const [w, c, t] = [1, 2, 4].map((bit) => !!(mask & bit));
      expect(view.nodes).toHaveLength((w ? 2 : 0) + (c ? 2 : 0) + (t ? 3 : 0));
      expect(view.edges.filter((edge) => edge.kind.endsWith("workspace") || edge.kind.endsWith("worktree"))).toHaveLength((w && c ? 2 : 0) + (t && (c || w) ? 3 : 0));
      expect(pairs(view)).toEqual(t ? ["t1>t2:2", "t1>t3:4", "t2>t1:1", "t3>t2:3"] : c ? ["c1>c2:5", "c2>c1:1"] : w ? ["w1>w2:5", "w2>w1:1"] : []);
      expect(view.edges.some((edge) => edge.source === edge.target)).toBe(false);
      if (w && !c && t) expect(view.edges).toContainEqual(expect.objectContaining({ source: "t1", target: "w1", kind: "terminal-in-workspace" }));
      if (!t && (c || w)) {
        const message = view.edges.find((edge) => edge.kind === "communication" && edge.source === (c ? "c1" : "w1"))!;
        expect(message.sources).toEqual(["codex", "herdr"]);
        expect(message.lastObservedAt).toBe("2026-11-12T01:00:00Z");
        expect(view.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(1);
      }
    });
  }
  it("focuses collapsed containers using projected adjacency without adding unrelated siblings", () => {
    for (const hiddenKinds of [["terminal"], ["terminal", "worktree"]] as const) {
      const focus = hiddenKinds.length === 1 ? "c1" : "w1";
      const extended: GraphData = { ...data, nodes: [...data.nodes, { id: "unrelated", kind: "workspace", label: "Elsewhere" }] };
      const view = projectGraph(extended, { ...filters, hiddenKinds, focus });
      expect(view.nodes.some((node) => node.id === (focus === "c1" ? "c2" : "w2"))).toBe(true);
      expect(view.nodes.some((node) => node.id === "unrelated")).toBe(false);
      expect(pairs(view)).toHaveLength(2);
    }
  });
  it("preserves legacy workspace-group membership while using its projected root for collapsed focus", () => {
    const grouped = { ...data, groups: [{ id: "legacy", label: "Project", machineId: "one", nodeIds: ["w1", "c1", "t1", "t3"] }] };
    const all = projectGraph(grouped, { ...filters, focus: "legacy" });
    expect(all.nodes.map((node) => node.id)).toEqual(["w1", "c1", "t1", "t3"]);
    const expected = [[], ["w1", "w2"], ["c1", "c2"], ["w1", "w2", "c1", "c2"], ["t1", "t3"], ["w1", "t1", "t3"], ["c1", "t1", "t3"], ["w1", "c1", "t1", "t3"]];
    for (let mask = 0; mask < 8; mask++) {
      const hiddenKinds = (["workspace", "worktree", "terminal"] as const).filter((_, index) => !(mask & (1 << index)));
      const collapsed = projectGraph(grouped, { ...filters, focus: "legacy", hiddenKinds });
      expect(collapsed.nodes.map((node) => node.id)).toEqual(expected[mask]!);
    }
  });
  it("does not borrow a hidden sibling's receipts when a focused terminal shares its container", () => {
    const view = projectGraph(data, { ...filters, focus: "t1", hiddenKinds: ["terminal"] });
    expect(pairs(view)).toEqual(["c1>c2:2", "c2>c1:1"]);
    expect(view.edges.find((edge) => edge.source === "c1" && edge.kind === "communication")).toMatchObject({ sources: ["codex"], lastObservedAt: "2026-11-11T01:00:00Z" });
  });
  it("never revives non-type-excluded endpoints through a retained container", () => {
    const hiddenKinds = ["terminal"] as const;
    expect(pairs(projectGraph(data, { ...filters, hiddenKinds, showCompleted: false }))).toEqual(["c1>c2:2", "c2>c1:1"]);
    for (const patch of [{ search: "Build" }, { machine: "one" }, { status: "done" }]) {
      expect(pairs(projectGraph(data, { ...filters, hiddenKinds, ...patch }))).toEqual([]);
    }
    const view = projectGraph(data, { ...filters, hiddenKinds: ["terminal", "worktree"], search: "Build" });
    expect(view.nodes.map((node) => node.id)).toEqual(["w1"]);
  });
  it("handles mixed plain folders and orphan checkouts without invented ancestry", () => {
    const mixed: GraphData = { nodes: data.nodes.filter((node) => node.id !== "c2"), edges: data.edges.filter((edge) => edge.source !== "c2").map((edge) => edge.target === "c2" ? { ...edge, target: "w2", kind: "terminal-in-workspace" } : edge) };
    expect(pairs(projectGraph(mixed, { ...filters, hiddenKinds: ["terminal"] }))).toEqual(["c1>w2:5", "w2>c1:1"]);
    expect(pairs(projectGraph(mixed, { ...filters, hiddenKinds: ["terminal", "workspace"] }))).toEqual([]);
    const orphan = { ...data, edges: data.edges.filter((edge) => edge.id !== "c2w2") };
    expect(pairs(projectGraph(orphan, { ...filters, hiddenKinds: ["terminal", "worktree"] }))).toEqual([]);
  });
  it("applies the recent relationship window before visible aggregation", () => {
    const view = projectGraph(data, { ...filters, hiddenKinds: ["terminal"], communication: "recent" }, Date.parse("2026-11-12T03:00:00Z"));
    expect(pairs(view)).toEqual(["c1>c2:3", "c2>c1:1"]);
    expect(view.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(1);
    expect(data.edges.find((edge) => edge.id === "m1")!.eventCount).toBe(2);
  });
});
