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
    { ...workspace, workspace_id: "main", label: "Orchard", worktree: { repo_key: "/orchard/.git", repo_name: "Orchard", repo_root: "/orchard", checkout_path: "/orchard", is_linked_worktree: false } },
    { ...workspace, workspace_id: "branch", label: "Review branch", worktree: { repo_key: "/orchard/.git", repo_name: "Orchard", repo_root: "/orchard", checkout_path: "/orchard-review", is_linked_worktree: true } },
    { ...workspace, workspace_id: "notes", label: "Plain notes", worktree: undefined },
  ];
  snapshot.tabs = snapshot.workspaces.map((item) => ({ ...tab, workspace_id: item.workspace_id, tab_id: `tab-${item.workspace_id}`, label: `Shell ${item.workspace_id}` }));
  snapshot.panes = snapshot.tabs.map((item) => ({ ...pane, workspace_id: item.workspace_id, tab_id: item.tab_id, pane_id: `pane-${item.workspace_id}`, terminal_id: `terminal-${item.workspace_id}`, agent: null, agent_session: null, agent_status: "idle", cwd: item.workspace_id === "notes" ? "/notes" : item.workspace_id === "branch" ? "/orchard-review" : "/orchard" }));
  snapshot.graph_repositories = snapshot.panes.filter((pane) => pane.workspace_id !== "notes").map((pane) => ({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, cwd: pane.cwd!, common_directory: "/orchard/.git", root: pane.cwd!, remote: "https://github.com/team/orchard" }));
  snapshot.agents = []; snapshot.flock_bindings = [];
  const registry: GraphRegistry = { version: 1, revision: 0, works: [], sessions: [], executions: [], checkouts: [] };
  const machines = [machine], rows = () => graphRegistryInventory(registry, machines);
  const graph = () => graphInventory(registry, rows(), machines);
  return { machine, snapshot, registry, machines, rows, graph };
}
test("one remote repository owns direct terminals from multiple checkouts and machines", () => {
  const state = inventory();
  const remote = structuredClone(state.machine); remote.id = "south"; remote.name = "South";
  state.machines.push(remote);
  const graph = state.graph(), hubs = graph.nodes.filter((node) => node.kind === "repository");
  expect(hubs).toHaveLength(3); // one repository, two machine-scoped folders
  const repo = hubs.find((node) => node.repositoryKey === "https://github.com/team/orchard")!;
  expect(repo).toBeDefined(); expect(repo.machineId).toBeUndefined();
  expect(repo.status).toBeUndefined(); expect(repo.hasWorkingTerminals).toBeUndefined();
  expect(graph.nodes.filter((node) => node.kind === "terminal")).toHaveLength(6);
  expect(graph.nodes.every((node) => node.kind === "repository" || node.kind === "terminal")).toBe(true);
  expect(graph.edges.filter((edge) => edge.target === repo.id)).toHaveLength(4);
  expect(repo.detail).toContain("/orchard-review"); expect(repo.detail).toContain("South");
  expect(graphTarget(state.registry, state.rows(), repo.id, state.machines)).toBeNull();
  const filtered = projectGraph(graph, { ...DEFAULT_GRAPH_STATE.filters, machine: "south" });
  expect(filtered.nodes).toContainEqual(repo);
  expect(filtered.nodes.filter((node) => node.kind === "terminal").every((node) => node.machineId === "south")).toBe(true);
});
test("different hosts, owners and forks stay separate; local keys and folders never merge machines", () => {
  for (const identity of ["https://github.com/fork/orchard", "https://example.com/team/orchard", null]) {
    const state = inventory(), other = structuredClone(state.machine); other.id = "south";
    other.snapshot!.graph_repositories!.forEach((item) => item.remote = identity);
    state.machines.push(other);
    expect(state.graph().nodes.filter((node) => node.kind === "repository")).toHaveLength(4);
  }
  const state = inventory(); delete state.snapshot.graph_repositories;
  const other = structuredClone(state.machine); other.id = "south"; state.machines.push(other);
  expect(state.graph().nodes.filter((node) => node.kind === "repository")).toHaveLength(4);
});
test("replaced terminals reject remote evidence and exact navigation; hubs never choose a machine", () => {
  const state = inventory(), before = state.graph().nodes.find((node) => node.kind === "terminal")!;
  expect(graphTarget(state.registry, state.rows(), before.id, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: "pane-main" });
  state.snapshot.panes[0]!.terminal_id = "replacement";
  expect(graphTarget(state.registry, state.rows(), before.id, state.machines)).toBeNull();
  expect(state.graph().edges.find((edge) => edge.source === state.graph().nodes.find((node) => node.kind === "terminal")!.id)?.target).not.toBe(state.graph().nodes.find((node) => node.repositoryKey === "https://github.com/team/orchard")!.id);
});
test("sidebar status, background waits and disconnected freshness apply only to terminals", () => {
  const state = inventory(); state.snapshot.panes[0]!.agent_status = "working";
  state.snapshot.panes[1]!.agent_status = "done"; state.snapshot.panes[1]!.background_wait = true;
  const graph = state.graph();
  expect(graph.nodes.filter((node) => node.kind === "terminal").map((node) => node.status)).toEqual(["working", "waiting", "idle"]);
  expect(graph.nodes.filter((node) => node.kind === "repository").every((node) => node.status === undefined)).toBe(true);
  state.machine.state = "disconnected";
  expect(state.graph().nodes.filter((node) => node.kind === "terminal").every((node) => node.status === "unknown")).toBe(true);
});
test("legacy workspace focus retains exact checkout membership without expanding the shared hub", () => {
  const state = inventory(), graph = state.graph();
  const focused = projectGraph(graph, { ...DEFAULT_GRAPH_STATE.filters, focus: `workspace:${JSON.stringify([state.machine.id, "branch"])}` });
  expect(focused.nodes.filter((node) => node.kind === "terminal")).toHaveLength(1);
  expect(focused.nodes.find((node) => node.kind === "terminal")!.detail).toContain("Review branch");
});

test("current discovery overrides old workspace Git metadata when a terminal leaves Git", () => {
  const state = inventory(); state.snapshot.graph_repositories = [];
  const hubs = state.graph().nodes.filter((node) => node.kind === "repository");
  expect(hubs).toHaveLength(3);
  expect(hubs.every((hub) => hub.label.startsWith("Folder"))).toBe(true);
});
