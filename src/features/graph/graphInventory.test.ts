import { describe, expect, it } from "bun:test";
import type { GraphRegistry } from "../../../shared/graph-registry.ts";
import { graphBinding, graphRegistryInventory } from "../../../shared/graph-registry-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import { graphInventory, graphTarget } from "./graphInventory.ts";
import { projectGraph, type GraphData } from "./graphModel.ts";
import { DEFAULT_GRAPH_STATE } from "./graphState.ts";

function source(names = ["obsidian", "phone", "social"]) {
  const machine = structuredClone(fixture.machines[0]) as Machine;
  const snapshot = machine.snapshot!;
  const pane = snapshot.panes[0]!, tab = snapshot.tabs.find((tab) => tab.tab_id === pane.tab_id)!;
  const workspace = snapshot.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)!;
  workspace.label = "infra";
  workspace.tokens = { branch: "main" };
  workspace.worktree = { repo_key: "infra", repo_name: "infra", repo_root: "/fictional/infra", checkout_path: "/fictional/infra", is_linked_worktree: false };
  snapshot.workspaces = [workspace]; snapshot.herdr_lifetime = "fixture-lifetime";
  snapshot.tabs = names.map((name, index) => ({ ...tab, tab_id: `tab-${index}`, label: name, number: index + 1, agent_status: "idle" }));
  snapshot.panes = snapshot.tabs.map((tab, index) => ({ ...pane, pane_id: `pane-${index}`, tab_id: tab.tab_id, terminal_id: `terminal-${index}`, agent: null, agent_session: null, agent_status: "idle", cwd: "/fictional/infra" }));
  snapshot.agents = []; snapshot.flock_bindings = [];
  const registry: GraphRegistry = { version: 1, revision: 0, works: [], sessions: [], executions: [], checkouts: [] };
  const machines = [machine];
  const rows = () => graphRegistryInventory(registry, machines);
  const graph = () => graphInventory(registry, rows(), machines);
  return { machine, snapshot, workspace, registry, machines, rows, graph };
}
const tabNodes = (graph: GraphData) => graph.nodes.filter((node) => node.kind === "tab");
const relationships = (graph: GraphData) => graph.edges.filter((edge) => edge.kind === "communication" || edge.kind === "delegation");

it("exposes individual split panes under their tab, hidden by default", () => {
  const state = source(["Code"]), first = state.snapshot.panes[0]!;
  first.label = "Build shell";
  state.snapshot.panes.push({ ...first, pane_id: "split-shell", terminal_id: "split-terminal", label: "Test shell", agent_status: "working" });
  const data = state.graph(), panes = data.nodes.filter((node) => node.kind === "pane");
  expect(panes.map((node) => node.label)).toEqual(["Build shell", "Test shell"]);
  expect(panes.map((node) => node.status)).toEqual(["idle", "working"]);
  expect(projectGraph(data, DEFAULT_GRAPH_STATE.filters).nodes.some((node) => node.kind === "pane")).toBe(false);
  const visible = projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, hiddenKinds: [] });
  expect(visible.nodes.filter((node) => node.kind === "pane")).toHaveLength(2);
  const parent = tabNodes(data)[0]!.id;
  expect(data.edges.filter((edge) => edge.kind === "pane-in-tab").map((edge) => edge.target)).toEqual([parent, parent]);
  for (const [index, node] of panes.entries()) expect(graphTarget(state.registry, state.rows(), node.id, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: state.snapshot.panes[index]!.pane_id });
});

it("keeps pane identity through sibling changes and refuses a replaced pane occupant", () => {
  const state = source(["Code"]), first = agent(state, 0);
  const selected = state.graph().nodes.find((node) => node.kind === "pane")!.id;
  state.snapshot.panes.push({ ...first, pane_id: "sibling", terminal_id: "sibling-terminal", agent: null, agent_session: null });
  first.label = "Renamed"; first.cwd = "/fictional/new-place";
  expect(state.graph().nodes.find((node) => node.kind === "pane" && node.label === "Renamed")!.id).toBe(selected);
  const open = () => graphTarget(state.registry, state.rows(), selected, state.machines);
  expect(open()).toEqual({ machine_id: state.machine.id, pane_id: first.pane_id });
  state.machine.state = "disconnected"; expect(open()).toBeNull();
  state.machine.state = "connected"; first.restore_error = "fixture"; expect(open()).toBeNull();
  delete first.restore_error;
  first.terminal_id = "replacement"; expect(open()).toBeNull();
  first.terminal_id = "terminal-0";
  first.agent_session!.value = "replacement-session";
  expect(open()).toBeNull();
});

it("keeps a healthy shell pane openable when another split lacks an agent proof", () => {
  const state = source(["Code"]), first = state.snapshot.panes[0]!;
  first.label = "Healthy shell";
  state.snapshot.panes.push({ ...first, pane_id: "unverified", terminal_id: "unverified-terminal", label: "Unverified agent", agent: "codex", agent_session: null });
  const data = state.graph();
  const shell = data.nodes.find((node) => node.kind === "pane" && node.label === "Healthy shell")!;
  const unverified = data.nodes.find((node) => node.kind === "pane" && node.label === "Unverified agent")!;
  expect(shell.freshness).toBe("live");
  expect(unverified.freshness).toBe("unsupported");
  expect(graphTarget(state.registry, state.rows(), shell.id, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: first.pane_id });
  expect(graphTarget(state.registry, state.rows(), unverified.id, state.machines)).toBeNull();
});

function agent(state: ReturnType<typeof source>, index: number, native = `00000000-0000-4000-8000-00000000000${index}`) {
  const pane = state.snapshot.panes[index]!;
  pane.agent = "codex"; pane.agent_status = "working";
  pane.agent_session = { agent: "codex", kind: "id", source: "fixture", value: native };
  state.snapshot.flock_bindings!.push({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent, native_session_id: native });
  return pane;
}

describe("workspace tabs in Graph", () => {
  it("shows the native workspace and its three named tabs once", () => {
    const state = source(); agent(state, 0);
    const data = state.graph();
    expect(tabNodes(data).map((node) => node.label)).toEqual(["obsidian", "phone", "social"]);
    expect(data.nodes.filter((node) => node.kind === "workspace")).toHaveLength(1);
    expect(relationships(data)).toEqual([]);
    const focus = data.groups!.find((group) => group.label === "infra")!;
    expect(tabNodes(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, focus: focus.id })).map((node) => node.label)).toEqual(["obsidian", "phone", "social"]);
    expect(data.nodes[0]!.detail).toContain("main");
    expect(data.nodes[0]!.detail).toContain("/fictional/infra");
    expect(data.nodes[0]!.detail).toContain("codex");
    expect(data.nodes[0]!.detail!.split("\n").filter((line) => line === "/fictional/infra")).toHaveLength(1);
  });
  it("includes nested sidebar worktrees and their horizontal tabs under the correct parent", () => {
    const state = source(["obsidian"]);
    const { snapshot, workspace } = state;
    const child = { ...workspace, workspace_id: "phone-worktree", label: "phone", worktree: { ...workspace.worktree!, checkout_path: "/fictional/phone", is_linked_worktree: true } };
    const secondRoot = { ...workspace, workspace_id: "other-infra", label: "other infra" };
    const secondChild = { ...child, workspace_id: "social-worktree", label: "social" };
    snapshot.workspaces.push(child, secondRoot, secondChild);
    for (const [index, workspace] of [child, secondChild].entries()) {
      const tab = { ...snapshot.tabs[0]!, workspace_id: workspace.workspace_id, tab_id: `child-tab-${index}`, label: "1", number: 1 };
      snapshot.tabs.push(tab);
      snapshot.panes.push({ ...snapshot.panes[0]!, workspace_id: workspace.workspace_id, tab_id: tab.tab_id, pane_id: `child-pane-${index}`, terminal_id: `child-terminal-${index}` });
    }
    let data = state.graph();
    const focus = (label: string) => tabNodes(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, focus: data.groups!.find((group) => group.label === label)!.id })).map((node) => node.label);
    expect(focus("infra")).toEqual(["obsidian", "phone"]);
    expect(focus("phone")).toEqual(["phone"]);
    expect(focus("other infra")).toEqual(["social"]);
    expect(tabNodes(data)).toHaveLength(3);
    const phone = snapshot.tabs.find((tab) => tab.workspace_id === child.workspace_id)!;
    phone.label = "review";
    snapshot.tabs.push({ ...phone, tab_id: "phone-test", label: "test", number: 2 });
    snapshot.panes.push({ ...snapshot.panes.find((pane) => pane.workspace_id === child.workspace_id)!, tab_id: "phone-test", pane_id: "phone-test-pane", terminal_id: "phone-test-terminal" });
    data = state.graph();
    expect(focus("phone")).toEqual(["phone · review", "phone · test"]);
    expect(tabNodes(data)).toHaveLength(4);
  });
  it("represents mixed and multi-agent split panes once, retaining details and guarded opening", () => {
    const state = source(["obsidian"]), pane = agent(state, 0);
    state.snapshot.panes.push({ ...pane, pane_id: "split-shell", terminal_id: "split-shell-terminal", agent: null, agent_session: null });
    const data = state.graph();
    expect(tabNodes(data)).toHaveLength(1);
    const selected = data.nodes[0]!.id;
    expect(graphTarget(state.registry, state.rows(), selected, state.machines)).toEqual({ machine_id: state.machine.id, pane_id: pane.pane_id });
    state.snapshot.flock_bindings = [];
    expect(state.graph().nodes[0]!.id).toBe(selected);
    expect(graphTarget(state.registry, state.rows(), selected, state.machines)).toBeNull();
  });
  it("keeps names separate from identity and rejects replacement terminals, occupants and pane sets", () => {
    const state = source(["obsidian"]), pane = agent(state, 0);
    const selected = state.graph().nodes[0]!.id;
    state.snapshot.tabs[0]!.label = "renamed";
    state.snapshot.panes.reverse();
    expect(state.graph().nodes[0]!.id).toBe(selected);
    const open = () => graphTarget(state.registry, state.rows(), selected, state.machines);
    expect(open()).not.toBeNull();
    state.machine.state = "disconnected"; expect(open()).toBeNull();
    state.machine.state = "connected"; pane.restore_error = "fixture error"; expect(open()).toBeNull();
    delete pane.restore_error;
    pane.terminal_id = "replacement"; expect(open()).toBeNull();
    pane.terminal_id = "terminal-0";
    pane.agent_session!.value = "replacement-native";
    state.snapshot.flock_bindings![0]!.native_session_id = "replacement-native";
    expect(open()).toBeNull();
    pane.agent_session!.value = "00000000-0000-4000-8000-000000000000";
    state.snapshot.flock_bindings![0]!.native_session_id = pane.agent_session!.value;
    expect(open()).not.toBeNull();
    state.snapshot.panes.push({ ...pane, pane_id: "new-split", terminal_id: "new-split-terminal" });
    expect(open()).toBeNull();
  });
  it("keeps equal labels on separate machines distinct and unknown registry non-targetable", () => {
    const state = source(["phone"]);
    const remote = structuredClone(state.machine); remote.id = "remote";
    state.machines.push(remote);
    const data = state.graph();
    expect(tabNodes(data)).toHaveLength(2);
    expect(data.nodes[0]!.id).not.toBe(data.nodes[1]!.id);
    expect(graphInventory(null, [], state.machines).nodes).toEqual([]);
    expect(graphTarget(null, [], data.nodes[0]!.id, state.machines)).toBeNull();
  });
  it("keeps mapped tab links and moves unrepresented endpoint activity into details", () => {
    const state = source();
    const parent = agent(state, 0), child = agent(state, 1), absent = "00000000-0000-4000-8000-000000000009";
    const native = (pane: typeof parent) => pane.agent_session!.value;
    state.registry.observations = [
      { id: "launch", kind: "delegation", source: "codex", machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: native(child), occurred_at: "2026-11-10T00:00:00Z" },
      ...["message-1", "message-2"].map((id) => ({ id, kind: "communication" as const, source: "codex" as const, machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: native(child), occurred_at: "2026-11-10T00:01:00Z" })),
      { id: "closed-child", kind: "delegation", source: "codex", machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: absent, occurred_at: "2026-11-10T00:02:00Z" },
    ];
    const data = state.graph(), obsidian = data.nodes.find((node) => node.label === "obsidian")!, phone = data.nodes.find((node) => node.label === "phone")!;
    expect(tabNodes(data)).toHaveLength(3);
    expect(data.nodes.filter((node) => node.kind === "workspace")).toHaveLength(1);
    expect(data.edges.find((edge) => edge.kind === "communication")).toMatchObject({ source: obsidian.id, target: phone.id, eventCount: 2, sources: ["codex"] });
    expect(data.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(1);
    expect(obsidian.activity).toHaveLength(1);
    expect(obsidian.activity![0]).toMatchObject({ label: "Codex 00000000", kind: "delegation", direction: "outgoing", eventCount: 1, lastObservedAt: "2026-11-10T00:02:00Z", sources: ["codex"] });
    expect(phone.activity).toBeUndefined();
  });
  it("folds multiple endpoint pairs into one counted tab relationship and omits same-tab links", () => {
    const state = source(["obsidian", "phone"]);
    agent(state, 0); agent(state, 1);
    const third = { ...state.snapshot.panes[0]!, pane_id: "third", terminal_id: "third-terminal" };
    state.snapshot.panes.push(third); agent(state, 2);
    state.registry.observations = [[0, 1], [2, 1], [0, 2]].map(([from, to], index) => ({ id: `message-${index}`, kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: state.snapshot.panes[from!]!.agent_session!.value, target_native_session_id: state.snapshot.panes[to!]!.agent_session!.value, occurred_at: "2026-11-10T00:00:00Z" }));
    const data = state.graph();
    expect(tabNodes(data)).toHaveLength(2);
    expect(relationships(data)).toHaveLength(1);
    expect(relationships(data)[0]!.eventCount).toBe(2);
  });
  it("uses the logical session's current tab for receipts without duplicating its execution", () => {
    const state = source(["obsidian", "phone"]), pane = agent(state, 0), second = agent(state, 1);
    const binding = graphBinding(state.machine, pane)!;
    state.registry.sessions = [{ id: "logical", name: "Logical alias", work_id: null, current_execution_id: "current" }];
    state.registry.executions = [{ ...binding, id: "current", session_id: "logical", checkout_id: null, created_at: "2026-11-10T00:00:00Z" }];
    state.registry.observations = [{ id: "message", kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: binding.native_session_id, target_native_session_id: second.agent_session!.value, occurred_at: "2026-11-10T00:00:00Z" }];
    const data = state.graph();
    expect(tabNodes(data).map((node) => node.label)).toEqual(["obsidian", "phone"]);
    expect(data.nodes[0]!.detail).toContain("Logical alias");
    expect(relationships(data)).toHaveLength(1);
    expect(data.edges[0]!.source).toBe(data.nodes[0]!.id);
    expect(graphTarget(state.registry, state.rows(), "session:logical", state.machines)).toBeNull();
  });
});

it("guards Herdr-only occupants using private inventory rows when the ordinary roster omits proofs", () => {
  for (const kind of ["tab", "pane"] as const) {
    const state = source(["obsidian", "phone"]);
    const pane = state.snapshot.panes[0]!; pane.agent = "claude";
    const endpoint = { server_id: "server", boot_id: "boot", terminal_id: pane.terminal_id, agent_instance_id: "occupant", agent: pane.agent, pane_id: pane.pane_id, name: "Review worker" };
    state.snapshot.flock_coordination = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
    const raw = () => state.machines.map((machine) => ({ ...machine, snapshot: { ...machine.snapshot!, flock_bindings: undefined, flock_coordination: undefined } }));
    const selected = graphInventory(state.registry, state.rows(), raw()).nodes.find((node) => node.kind === kind)!.id;
    const open = () => graphTarget(state.registry, state.rows(), selected, raw());
    expect(open()).toEqual({ machine_id: state.machine.id, pane_id: pane.pane_id });
    endpoint.agent_instance_id = "replacement";
    expect(open()).toBeNull();
    endpoint.agent_instance_id = "occupant";
    expect(open()).not.toBeNull();
    state.snapshot.flock_coordination = undefined;
    expect(open()).toBeNull();
  }
});

it("rejects an old private binding when the ordinary roster reports a replacement native session", () => {
  for (const kind of ["tab", "pane"] as const) {
    const state = source(["obsidian"]); agent(state, 0);
    const verified = state.rows();
    const ordinary = structuredClone(state.machines);
    ordinary[0]!.snapshot!.flock_bindings = undefined;
    const selected = graphInventory(state.registry, verified, ordinary).nodes.find((node) => node.kind === kind)!.id;
    ordinary[0]!.snapshot!.panes[0]!.agent_session!.value = "replacement-native";
    const replacement = graphInventory(state.registry, verified, ordinary).nodes.find((node) => node.kind === kind)!;
    expect(replacement.id).not.toBe(selected);
    expect(replacement.freshness).toBe("unsupported");
    expect(graphTarget(state.registry, verified, selected, ordinary)).toBeNull();
    expect(graphTarget(state.registry, verified, replacement.id, ordinary)).toBeNull();
  }
});

it("does not attach a historical session's recorded relationship using only a public native hint", () => {
  const state = source(["obsidian"]), pane = agent(state, 0), binding = graphBinding(state.machine, pane)!;
  state.registry.sessions = [{ id: "historical", name: "Earlier conversation", work_id: null, current_execution_id: "earlier" }];
  state.registry.executions = [{ ...binding, id: "earlier", session_id: "historical", checkout_id: null, created_at: "2026-11-10T00:00:00Z" }];
  state.registry.observations = [{ id: "earlier-message", kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: binding.native_session_id, target_native_session_id: "00000000-0000-4000-8000-000000000009", occurred_at: "2026-11-10T00:00:00Z" }];
  state.snapshot.flock_bindings = [];
  const data = state.graph();
  expect(relationships(data)).toEqual([]);
  expect(tabNodes(data)).toHaveLength(1);
  expect(data.nodes[0]!.activity).toBeUndefined();
  expect(graphTarget(state.registry, state.rows(), data.nodes.find((node) => node.kind === "tab")!.id, state.machines)).toBeNull();
});

it("retains proven native identity through optional coordination changes while guarding Herdr-only occupants", () => {
  const state = source(["obsidian"]), pane = agent(state, 0);
  const endpoint = { server_id: "server", boot_id: "boot", terminal_id: pane.terminal_id, agent_instance_id: "first-occupant", agent: pane.agent!, pane_id: pane.pane_id, name: "Worker" };
  const coordination = { version: 1 as const, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
  const nativeId = state.graph().nodes[0]!.id;
  for (const current of [coordination, undefined, coordination]) {
    state.snapshot.flock_coordination = current;
    expect(state.graph().nodes[0]!.id).toBe(nativeId);
    expect(graphTarget(state.registry, state.rows(), nativeId, state.machines)).not.toBeNull();
  }
  endpoint.agent_instance_id = "resumed-native-occupant";
  expect(state.graph().nodes[0]!.id).toBe(nativeId);
  expect(graphTarget(state.registry, state.rows(), nativeId, state.machines)).not.toBeNull();
  state.snapshot.flock_bindings = [];
  const herdrOnlyId = state.graph().nodes[0]!.id;
  expect(graphTarget(state.registry, state.rows(), herdrOnlyId, state.machines)).not.toBeNull();
  endpoint.agent_instance_id = "replacement-with-unverified-native-hint";
  expect(graphTarget(state.registry, state.rows(), herdrOnlyId, state.machines)).toBeNull();
});


it("counts recorded activity once per endpoint pair, retaining direction without drawing ghost nodes", () => {
  const state = source(["shared-action"]); agent(state, 0);
  const pane = state.snapshot.panes[0]!;
  state.snapshot.panes.push({ ...pane, pane_id: "split-agent", terminal_id: "split-terminal" }); agent(state, 1);
  const missing = "01a1a426-0000-4000-8000-000000000000";
  state.registry.observations = [0, 1].map((index) => ({ id: `send-${index}`, kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: state.snapshot.panes[index]!.agent_session!.value, target_native_session_id: missing, occurred_at: `2026-11-10T00:0${index}:00Z` }));
  state.registry.observations.push(structuredClone(state.registry.observations[0]!));
  state.registry.observations.push({ id: "reply", kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: missing, target_native_session_id: pane.agent_session!.value, occurred_at: "2026-11-10T00:02:00Z" });
  const data = state.graph();
  expect(tabNodes(data).map((node) => node.label)).toEqual(["shared-action"]);
  expect(relationships(data)).toEqual([]);
  expect(data.nodes[0]!.activity).toHaveLength(2);
  expect(data.nodes[0]!.activity!.find((item) => item.direction === "outgoing")).toMatchObject({ label: "Codex 01a1a426", kind: "communication", eventCount: 2, lastObservedAt: "2026-11-10T00:01:00Z", sources: ["codex"] });
  expect(data.nodes[0]!.activity!.find((item) => item.direction === "incoming")?.eventCount).toBe(1);
  expect(new Set(data.nodes[0]!.activity!.map((item) => item.endpointId)).size).toBe(1);
});
