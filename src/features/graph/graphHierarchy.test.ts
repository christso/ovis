import { expect, test } from "bun:test";
import type { GraphRegistry } from "../../../shared/graph-registry.ts";
import { graphRegistryInventory } from "../../../shared/graph-registry-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import { graphInventory, graphTarget } from "./graphInventory.ts";
import { DEFAULT_GRAPH_STATE } from "./graphState.ts";
import { projectGraph } from "./graphModel.ts";

function inventory() {
  const machine = structuredClone(fixture.machines[0]) as Machine;
  const snapshot = machine.snapshot!, workspace = snapshot.workspaces[0]!, tab = snapshot.tabs[0]!, pane = snapshot.panes[0]!;
  snapshot.herdr_lifetime = "hierarchy-lifetime"; machine.state = "connected";
  snapshot.workspaces = [
    { ...workspace, workspace_id: "main", label: "Orchard", worktree: { repo_key: "orchard", repo_name: "Orchard", repo_root: "/orchard", checkout_path: "/orchard", is_linked_worktree: false } },
    { ...workspace, workspace_id: "branch", label: "Review branch", worktree: { repo_key: "orchard", repo_name: "Orchard", repo_root: "/orchard", checkout_path: "/orchard-review", is_linked_worktree: true } },
    { ...workspace, workspace_id: "notes", label: "Plain notes", worktree: undefined },
  ];
  snapshot.tabs = snapshot.workspaces.map((item) => ({ ...tab, workspace_id: item.workspace_id, tab_id: `tab-${item.workspace_id}`, label: `Shell ${item.workspace_id}` }));
  snapshot.panes = snapshot.tabs.map((item) => ({ ...pane, workspace_id: item.workspace_id, tab_id: item.tab_id, pane_id: `pane-${item.workspace_id}`, terminal_id: `terminal-${item.workspace_id}`, agent: null, agent_session: null, agent_status: "idle", cwd: item.workspace_id === "notes" ? "/notes" : "/orchard" }));
  snapshot.agents = []; snapshot.flock_bindings = [];
  const registry: GraphRegistry = { version: 1, revision: 0, works: [], sessions: [], executions: [], checkouts: [] };
  const machines = [machine], rows = () => graphRegistryInventory(registry, machines);
  const graph = () => graphInventory(registry, rows(), machines);
  return { machine, snapshot, registry, machines, rows, graph };
}

test("native workspace hubs connect their worktrees and tabs, including plain folders", () => {
  const state = inventory(), graph = state.graph();
  expect(graph.nodes.filter((node) => node.kind === "workspace")).toHaveLength(2);
  expect(graph.nodes.filter((node) => node.kind === "worktree")).toHaveLength(1);
  expect(graph.nodes.filter((node) => node.kind === "terminal")).toHaveLength(3);
  const root = graph.nodes.find((node) => node.kind === "workspace" && node.label === "Orchard")!;
  const branch = graph.nodes.find((node) => node.kind === "worktree")!;
  const rootTab = graph.nodes.find((node) => node.label === "Shell main")!;
  const childTab = graph.nodes.find((node) => node.label.includes("Shell branch"))!;
  const notes = graph.nodes.find((node) => node.kind === "workspace" && node.label === "Plain notes")!;
  const notesTab = graph.nodes.find((node) => node.label === "Shell notes")!;
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: branch.id, target: root.id, kind: "worktree-in-workspace" }));
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: rootTab.id, target: root.id, kind: "terminal-in-workspace" }));
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: childTab.id, target: branch.id, kind: "terminal-in-worktree" }));
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: notesTab.id, target: notes.id, kind: "terminal-in-workspace" }));
  expect(notes.detail).toContain("/notes");
  const focus = projectGraph(graph, { ...DEFAULT_GRAPH_STATE.filters, focus: branch.id });
  expect(new Set(focus.nodes.map((node) => node.id))).toEqual(new Set([root.id, branch.id, childTab.id]));
});
test("hub navigation uses its own verified current tabs and rejects replaced occupants", () => {
  const state = inventory();
  const root = state.graph().nodes.find((node) => node.kind === "workspace" && node.label === "Orchard")!;
  expect(root).toBeDefined();
  const open = () => graphTarget(state.registry, state.rows(), root.id, state.machines);
  expect(open()).toEqual({ machine_id: state.machine.id, pane_id: "pane-main" });
  state.snapshot.panes[0]!.terminal_id = "replacement-terminal";
  expect(open()).toBeNull();
  const current = state.graph().nodes.find((node) => node.kind === "workspace" && node.label === "Orchard")!;
  state.snapshot.panes[0]!.agent = "codex";
  expect(graphTarget(state.registry, state.rows(), current.id, state.machines)).toBeNull();
});
test("empty workspaces and orphaned worktrees have honest independent hubs", () => {
  const state = inventory();
  state.snapshot.workspaces = state.snapshot.workspaces.filter((workspace) => workspace.workspace_id !== "main");
  state.snapshot.tabs = state.snapshot.tabs.filter((tab) => tab.workspace_id !== "main");
  state.snapshot.panes = state.snapshot.panes.filter((pane) => pane.workspace_id !== "main");
  state.snapshot.workspaces.push({ ...state.snapshot.workspaces[1]!, workspace_id: "empty", label: "Empty" });
  const graph = state.graph(), branch = graph.nodes.find((node) => node.kind === "worktree")!, empty = graph.nodes.find((node) => node.label === "Empty")!;
  expect(branch).toBeDefined(); expect(empty).toBeDefined();
  expect(graph.edges.some((edge) => edge.source === branch.id)).toBe(false);
  expect(graph.edges.some((edge) => edge.target === branch.id && edge.kind === "terminal-in-worktree")).toBe(true);
  expect(graphTarget(state.registry, state.rows(), empty.id, state.machines)).toBeNull();
});

test("completed rollups keep workspace and worktree context for active tabs", () => {
  const state = inventory();
  state.snapshot.panes[0]!.agent_status = "working";
  state.snapshot.panes[1]!.agent_status = "working";
  const doneTab = { ...state.snapshot.tabs[0]!, tab_id: "finished-tab", label: "Finished" };
  state.snapshot.tabs.push(doneTab);
  state.snapshot.panes.push({ ...state.snapshot.panes[0]!, tab_id: doneTab.tab_id, pane_id: "finished-pane", terminal_id: "finished-terminal", agent_status: "done" });
  const graph = state.graph(), visible = projectGraph(graph, DEFAULT_GRAPH_STATE.filters);
  const root = graph.nodes.find((node) => node.kind === "workspace" && node.label === "Orchard")!;
  const branch = graph.nodes.find((node) => node.kind === "worktree")!;
  const workingTabs = graph.nodes.filter((node) => node.kind === "terminal" && node.status === "working");
  expect(root.status).toBe("done");
  expect(root.hasWorkingTerminals).toBe(true);
  expect(branch.hasWorkingTerminals).toBe(true);
  expect(visible.nodes).toContainEqual(root);
  expect(visible.nodes).toContainEqual(branch);
  expect(workingTabs).toHaveLength(2);
  for (const tab of workingTabs) expect(visible.nodes).toContainEqual(tab);
  expect(visible.edges).toContainEqual(expect.objectContaining({ source: branch.id, target: root.id }));
  expect(visible.nodes.some((node) => node.kind === "terminal" && node.status === "done")).toBe(false);
});

test("workspace activity includes child worktrees and ignores selected tabs", () => {
  const state = inventory();
  state.snapshot.panes[1]!.agent_status = "working";
  state.snapshot.focused_workspace_id = "notes";
  state.snapshot.focused_tab_id = "tab-notes";
  const hubs = () => state.graph().nodes.filter((node) => node.kind !== "terminal");
  const root = () => hubs().find((node) => node.label === "Orchard")!;
  const branch = () => hubs().find((node) => node.kind === "worktree")!;
  expect(root().hasWorkingTerminals).toBe(true);
  expect(root().status).toBe("working");
  expect(branch().hasWorkingTerminals).toBe(true);
  expect(hubs().find((node) => node.label === "Plain notes")!.hasWorkingTerminals).toBe(false);
  state.snapshot.panes[1]!.agent_status = "done";
  expect(root().hasWorkingTerminals).toBe(false);
  expect(branch().hasWorkingTerminals).toBe(false);
  state.snapshot.panes[1]!.agent_status = "working";
  state.machine.state = "disconnected";
  expect(root().hasWorkingTerminals).toBe(false);
  expect(branch().hasWorkingTerminals).toBe(false);
});

test("hub opening skips unverified own tabs without substituting a child worktree", () => {
  const state = inventory();
  state.snapshot.panes[0]!.agent = "codex";
  const root = () => state.graph().nodes.find((node) => node.kind === "workspace" && node.label === "Orchard")!;
  const branch = state.graph().nodes.find((node) => node.kind === "worktree")!;
  expect(graphTarget(state.registry, state.rows(), branch.id, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: "pane-branch" });
  expect(graphTarget(state.registry, state.rows(), root().id, state.machines)).toBeNull();
  state.snapshot.tabs.push({ ...state.snapshot.tabs[0]!, tab_id: "own-shell", label: "Own shell" });
  state.snapshot.panes.push({ ...state.snapshot.panes[0]!, tab_id: "own-shell", pane_id: "own-shell-pane", terminal_id: "own-shell-terminal", agent: null });
  expect(graphTarget(state.registry, state.rows(), root().id, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: "own-shell-pane" });
});
