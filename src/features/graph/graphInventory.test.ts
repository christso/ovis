import { describe, expect, it } from "bun:test";
import type { FlockRegistry } from "../../../shared/flock.ts";
import { flockBinding, flockInventory } from "../../../shared/flock-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import { graphInventory, graphTarget } from "./graphInventory.ts";
import { projectGraph } from "./graphModel.ts";
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
  const registry: FlockRegistry = { version: 1, revision: 0, works: [], sessions: [], executions: [], checkouts: [] };
  const machines = [machine];
  const rows = () => flockInventory(registry, machines);
  const graph = () => graphInventory(registry, rows(), machines);
  return { machine, snapshot, workspace, registry, machines, rows, graph };
}
function agent(state: ReturnType<typeof source>, index: number, native = `00000000-0000-4000-8000-00000000000${index}`) {
  const pane = state.snapshot.panes[index]!;
  pane.agent = "codex"; pane.agent_status = "working";
  pane.agent_session = { agent: "codex", kind: "id", source: "fixture", value: native };
  state.snapshot.flock_bindings!.push({ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent, native_session_id: native });
  return pane;
}

describe("workspace tabs in Flock", () => {
  it("shows infra's three named tabs without repository, branch or execution duplicates", () => {
    const state = source(); agent(state, 0);
    const data = state.graph();
    expect(data.nodes.map((node) => node.label)).toEqual(["obsidian", "phone", "social"]);
    expect(data.nodes.every((node) => node.kind === "tab")).toBe(true);
    expect(data.edges).toEqual([]);
    const focus = data.groups!.find((group) => group.label === "infra")!;
    expect(projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, focus: focus.id }).nodes.map((node) => node.label)).toEqual(["obsidian", "phone", "social"]);
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
    const focus = (label: string) => projectGraph(data, { ...DEFAULT_GRAPH_STATE.filters, focus: data.groups!.find((group) => group.label === label)!.id }).nodes.map((node) => node.label);
    expect(focus("infra")).toEqual(["obsidian", "phone"]);
    expect(focus("phone")).toEqual(["phone"]);
    expect(focus("other infra")).toEqual(["social"]);
    expect(data.nodes).toHaveLength(3);
    const phone = snapshot.tabs.find((tab) => tab.workspace_id === child.workspace_id)!;
    phone.label = "review";
    snapshot.tabs.push({ ...phone, tab_id: "phone-test", label: "test", number: 2 });
    snapshot.panes.push({ ...snapshot.panes.find((pane) => pane.workspace_id === child.workspace_id)!, tab_id: "phone-test", pane_id: "phone-test-pane", terminal_id: "phone-test-terminal" });
    data = state.graph();
    expect(focus("phone")).toEqual(["phone · review", "phone · test"]);
    expect(data.nodes).toHaveLength(4);
  });
  it("represents mixed and multi-agent split panes once, retaining details and guarded opening", () => {
    const state = source(["obsidian"]), pane = agent(state, 0);
    state.snapshot.panes.push({ ...pane, pane_id: "split-shell", terminal_id: "split-shell-terminal", agent: null, agent_session: null });
    const data = state.graph();
    expect(data.nodes).toHaveLength(1);
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
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0]!.id).not.toBe(data.nodes[1]!.id);
    expect(graphInventory(null, [], state.machines).nodes).toEqual([]);
    expect(graphTarget(null, [], data.nodes[0]!.id, state.machines)).toBeNull();
  });
  it("maps native receipts onto tabs and retains only unrepresented historical endpoints", () => {
    const state = source();
    const parent = agent(state, 0), child = agent(state, 1), absent = "00000000-0000-4000-8000-000000000009";
    const native = (pane: typeof parent) => pane.agent_session!.value;
    state.registry.observations = [
      { id: "launch", kind: "delegation", source: "codex", machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: native(child), occurred_at: "2026-11-10T00:00:00Z" },
      ...["message-1", "message-2"].map((id) => ({ id, kind: "communication" as const, source: "codex" as const, machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: native(child), occurred_at: "2026-11-10T00:01:00Z" })),
      { id: "closed-child", kind: "delegation", source: "codex", machine_id: state.machine.id, source_native_session_id: native(parent), target_native_session_id: absent, occurred_at: "2026-11-10T00:02:00Z" },
    ];
    const data = state.graph(), obsidian = data.nodes.find((node) => node.label === "obsidian")!, phone = data.nodes.find((node) => node.label === "phone")!;
    expect(data.nodes).toHaveLength(4);
    expect(data.edges.find((edge) => edge.kind === "communication")).toMatchObject({ source: obsidian.id, target: phone.id, eventCount: 2, sources: ["codex"] });
    expect(data.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(2);
    const historical = data.nodes.find((node) => node.kind !== "tab")!;
    expect(historical.freshness).toBe("unavailable");
    expect(graphTarget(state.registry, state.rows(), historical.id, state.machines)).toBeNull();
  });
  it("folds multiple endpoint pairs into one counted tab relationship and omits same-tab links", () => {
    const state = source(["obsidian", "phone"]);
    agent(state, 0); agent(state, 1);
    const third = { ...state.snapshot.panes[0]!, pane_id: "third", terminal_id: "third-terminal" };
    state.snapshot.panes.push(third); agent(state, 2);
    state.registry.observations = [[0, 1], [2, 1], [0, 2]].map(([from, to], index) => ({ id: `message-${index}`, kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: state.snapshot.panes[from!]!.agent_session!.value, target_native_session_id: state.snapshot.panes[to!]!.agent_session!.value, occurred_at: "2026-11-10T00:00:00Z" }));
    const data = state.graph();
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]!.eventCount).toBe(2);
  });
  it("uses the logical session's current tab for receipts without duplicating its execution", () => {
    const state = source(["obsidian", "phone"]), pane = agent(state, 0), second = agent(state, 1);
    const binding = flockBinding(state.machine, pane)!;
    state.registry.sessions = [{ id: "logical", name: "Logical alias", work_id: null, current_execution_id: "current" }];
    state.registry.executions = [{ ...binding, id: "current", session_id: "logical", checkout_id: null, created_at: "2026-11-10T00:00:00Z" }];
    state.registry.observations = [{ id: "message", kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: binding.native_session_id, target_native_session_id: second.agent_session!.value, occurred_at: "2026-11-10T00:00:00Z" }];
    const data = state.graph();
    expect(data.nodes.map((node) => node.label)).toEqual(["obsidian", "phone"]);
    expect(data.nodes[0]!.detail).toContain("Logical alias");
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]!.source).toBe(data.nodes[0]!.id);
    expect(graphTarget(state.registry, state.rows(), "session:logical", state.machines)).toBeNull();
  });
});

it("guards Herdr-only occupants using private inventory rows when the ordinary roster omits proofs", () => {
  const state = source(["obsidian", "phone"]);
  const pane = state.snapshot.panes[0]!; pane.agent = "claude";
  const endpoint = { server_id: "server", boot_id: "boot", terminal_id: pane.terminal_id, agent_instance_id: "occupant", agent: pane.agent, pane_id: pane.pane_id, name: "Review worker" };
  state.snapshot.flock_coordination = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
  const raw = () => state.machines.map((machine) => ({ ...machine, snapshot: { ...machine.snapshot!, flock_bindings: undefined, flock_coordination: undefined } }));
  const selected = graphInventory(state.registry, state.rows(), raw()).nodes[0]!.id;
  const open = () => graphTarget(state.registry, state.rows(), selected, raw());
  expect(open()).toEqual({ machine_id: state.machine.id, pane_id: pane.pane_id });
  endpoint.agent_instance_id = "replacement";
  expect(open()).toBeNull();
  endpoint.agent_instance_id = "occupant";
  expect(open()).not.toBeNull();
  state.snapshot.flock_coordination = undefined;
  expect(open()).toBeNull();
});

it("rejects an old private binding when the ordinary roster reports a replacement native session", () => {
  const state = source(["obsidian"]); agent(state, 0);
  const verified = state.rows();
  const ordinary = structuredClone(state.machines);
  ordinary[0]!.snapshot!.flock_bindings = undefined;
  const selected = graphInventory(state.registry, verified, ordinary).nodes[0]!.id;
  ordinary[0]!.snapshot!.panes[0]!.agent_session!.value = "replacement-native";
  const replacement = graphInventory(state.registry, verified, ordinary).nodes[0]!;
  expect(replacement.id).not.toBe(selected);
  expect(replacement.freshness).toBe("unsupported");
  expect(graphTarget(state.registry, verified, selected, ordinary)).toBeNull();
  expect(graphTarget(state.registry, verified, replacement.id, ordinary)).toBeNull();
});

it("does not attach a historical session's recorded relationship using only a public native hint", () => {
  const state = source(["obsidian"]), pane = agent(state, 0), binding = flockBinding(state.machine, pane)!;
  state.registry.sessions = [{ id: "historical", name: "Earlier conversation", work_id: null, current_execution_id: "earlier" }];
  state.registry.executions = [{ ...binding, id: "earlier", session_id: "historical", checkout_id: null, created_at: "2026-11-10T00:00:00Z" }];
  state.registry.observations = [{ id: "earlier-message", kind: "communication", source: "codex", machine_id: state.machine.id, source_native_session_id: binding.native_session_id, target_native_session_id: "00000000-0000-4000-8000-000000000009", occurred_at: "2026-11-10T00:00:00Z" }];
  state.snapshot.flock_bindings = [];
  const data = state.graph();
  expect(data.edges[0]!.source).toBe("session:historical");
  expect(data.nodes.find((node) => node.id === "session:historical")?.freshness).toBe("unavailable");
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
