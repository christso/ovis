import { describe, expect, it } from "bun:test";
import type { FlockRegistry } from "../../../shared/flock.ts";
import { flockBinding, flockInventory } from "../../../shared/flock-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import type { GraphRelation } from "./graphModel.ts";
import { graphInventory, graphTarget } from "./graphInventory.ts";

function source() {
  const local = structuredClone(fixture.machines[0]) as Machine;
  const pane = local.snapshot!.panes.find((pane) => pane.agent === "codex")!;
  local.snapshot!.panes = [pane]; local.snapshot!.herdr_lifetime = "garden-lifetime";
  pane.terminal_id = "garden-terminal";
  local.snapshot!.flock_bindings = [{ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent!, native_session_id: "native-garden" }];
  pane.agent_session = { agent: pane.agent!, kind: "id", source: "fixture", value: "native-garden" };
  const remote = structuredClone(local); remote.id = "garden-remote"; remote.name = "Remote garden";
  const checkout = { id: "checkout-local", machine_id: local.id, path: "/fictional/checkout", repository: "/fictional/orchard", branch: "leaves" };
  const registry: FlockRegistry = { version: 1, revision: 1, works: [{ id: "work", name: "Garden work" }], sessions: [{ id: "session", name: "Prune", work_id: "work", current_execution_id: "new" }],
    checkouts: [checkout, { ...checkout, id: "checkout-remote", machine_id: remote.id }],
    executions: [{ ...flockBinding(local, pane)!, id: "old", session_id: "session", checkout_id: checkout.id, created_at: "2026-11-07T00:00:00Z" },
      { ...flockBinding(remote, remote.snapshot!.panes[0]!)!, id: "new", session_id: "session", checkout_id: "checkout-remote", created_at: "2026-11-07T00:01:00Z" }] };
  return { registry, machines: [local, remote], pane };
}

describe("shared inventory to Graph", () => {
  it("keeps a proven native execution selected across optional coordination loss and recovery", () => {
    const { machines, pane } = source();
    const machine = machines[0]!;
    const registry: FlockRegistry = { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
    const current = () => flockInventory(registry, [machine]);
    const selected = graphInventory(registry, current()).nodes.find((node) => node.kind === "execution")!;
    const endpoint = { server_id: "server", boot_id: "boot", terminal_id: pane.terminal_id, agent_instance_id: "occupancy", agent: pane.agent!, pane_id: pane.pane_id, name: "Native worker" };
    const page = { version: 1 as const, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
    for (const coordination of [page, undefined, page]) {
      machine.snapshot!.flock_coordination = coordination;
      const rows = current();
      expect(graphInventory(registry, rows).nodes.find((node) => node.kind === "execution")?.id).toBe(selected.id);
      expect(graphTarget(registry, rows, selected.id)).toEqual({ machine_id: machine.id, pane_id: pane.pane_id });
    }
    machine.snapshot!.flock_bindings![0]!.native_session_id = "replacement-native";
    expect(graphTarget(registry, current(), selected.id)).toBeNull();
  });

  it("shows Herdr delegation and messages to a live agent without treating its occupancy as a native session", () => {
    const { registry, machines, pane } = source();
    const machine = machines[0]!;
    const childPane = { ...pane, pane_id: "w2:p1", terminal_id: "child-terminal", agent: "claude", label: "Review worker" };
    machine.snapshot!.panes.push(childPane);
    const parent = { server_id: "server-one", boot_id: "boot-one", terminal_id: pane.terminal_id, agent_instance_id: "parent-occupancy", agent: "codex", pane_id: pane.pane_id, name: "Coordinator" };
    const child = { ...parent, terminal_id: childPane.terminal_id, agent_instance_id: "child-occupancy", agent: "claude", pane_id: childPane.pane_id, name: "Review worker" };
    Object.assign(machine.snapshot!, { flock_coordination: { version: 1, server_id: parent.server_id, boot_id: parent.boot_id, agents: [parent, child], receipts: [], cursor: null } });
    Object.assign(registry, {
      herdr_associations: [{ endpoint: parent, machine_id: machine.id, native_session_id: "native-garden" }, { endpoint: structuredClone(child), machine_id: machine.id, native_session_id: null }],
      observations: ["delegation", "communication", "communication"].map((kind, index) => ({ source: "herdr", id: `herdr-operation-${index}`, kind, source_endpoint: parent, target_endpoint: structuredClone(child), occurred_at: "2026-11-08T00:00:00Z", machine_id: machine.id })),
    });
    const rows = flockInventory(registry, machines), data = graphInventory(registry, rows);
    const delegation = data.edges.find((edge) => edge.kind === "delegation")!;
    const communication = data.edges.find((edge) => edge.kind === "communication")!;
    expect(delegation.source).toBe("session:session");
    expect(communication.source).toBe(delegation.source);
    expect(communication.target).toBe(delegation.target);
    expect(communication.eventCount).toBe(2);
    expect(delegation.evidence).toBe("herdr.delegation");
    const worker = data.nodes.find((node) => node.id === delegation.target)!;
    expect(worker.label).toBe("Review worker");
    expect(worker.freshness).toBe("live");
    expect(graphTarget(registry, rows, worker.id)).toEqual({ machine_id: machine.id, pane_id: childPane.pane_id });
    expect(rows.find((row) => row.pane?.terminal_id === childPane.terminal_id)?.binding).toBeNull();
    const execution = data.nodes.find((node) => node.kind === "execution" && node.label === "Review worker")!;
    expect(graphTarget(registry, rows, execution.id)).toEqual({ machine_id: machine.id, pane_id: childPane.pane_id });

    child.agent_instance_id = "replacement-occupancy";
    const replaced = flockInventory(registry, machines);
    expect(graphTarget(registry, replaced, worker.id)).toBeNull();
    expect(graphTarget(registry, replaced, execution.id)).toBeNull();
    expect(graphInventory(registry, replaced).nodes.find((node) => node.id === worker.id)?.freshness).toBe("unavailable");
    child.agent_instance_id = "child-occupancy";
    machine.state = "disconnected";
    expect(graphTarget(registry, flockInventory(registry, machines), worker.id)).toBeNull();
  });
  it("projects observed coordination onto logical sessions and keeps unbound native children unavailable", () => {
    const { registry, machines } = source();
    const own = "11111111-1111-4111-8111-111111111111", child = "22222222-2222-4222-8222-222222222222";
    for (const execution of registry.executions) execution.native_session_id = own;
    for (const machine of machines) machine.snapshot!.flock_bindings![0]!.native_session_id = own;
    Object.assign(registry, { observations: ["delegation", "communication", "communication"].map((kind, index) => ({ id: `call-${index}`, kind, source_native_session_id: own, target_native_session_id: child, occurred_at: "2026-11-08T00:00:00Z", source: "codex", machine_id: machines[0]!.id })) });
    const rows = flockInventory(registry, machines), data = graphInventory(registry, rows);
    const edges = data.edges.filter((edge) => edge.kind === "delegation" || edge.kind === "communication");
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.source === "session:session")).toBe(true);
    expect(edges.find((edge) => edge.kind === "communication")?.eventCount).toBe(2);
    const childNode = data.nodes.find((node) => node.detail === child)!;
    expect(childNode.freshness).toBe("unavailable");
    expect(graphTarget(registry, rows, childNode.id)).toBeNull();
    expect(graphTarget(registry, rows, "session:session")?.machine_id).toBe("garden-remote");
  });
  it("uses recorded associations, scopes repository metadata to machine and preserves logical identity", () => {
    const { registry, machines } = source();
    const data = graphInventory(registry, flockInventory(registry, machines));
    expect(data.nodes.filter((node) => node.kind === "repository")).toHaveLength(2);
    expect(data.nodes.find((node) => node.id === "session:session")?.machineId).toBeUndefined();
    expect(data.edges.map((edge) => edge.kind).sort()).toEqual((["checkout-in-repository", "checkout-in-repository", "execution-in-checkout", "execution-in-checkout", "session-execution", "session-execution", "work-session"] as GraphRelation[]).sort());
    expect(data.edges.every((edge) => edge.evidence.length > 0)).toBe(true);
    registry.sessions[0]!.current_execution_id = "old";
    expect(graphInventory(registry, flockInventory(registry, machines)).nodes.find((node) => node.kind === "session")?.id).toBe("session:session");
  });
  it("opens only current execution for a logical session and exact requested execution for execution nodes", () => {
    const { registry, machines, pane } = source(); const rows = flockInventory(registry, machines);
    expect(graphTarget(registry, rows, "session:session")).toEqual({ machine_id: "garden-remote", pane_id: pane.pane_id });
    expect(graphTarget(registry, rows, "execution:old")).toEqual({ machine_id: machines[0]!.id, pane_id: pane.pane_id });
    for (const id of ["work:work", "checkout:checkout-local", "session:missing", "execution:missing"]) expect(graphTarget(registry, rows, id)).toBeNull();
    machines[1]!.state = "disconnected";
    expect(graphTarget(registry, flockInventory(registry, machines), "session:session")).toBeNull();
    // A previous execution stays live; it must not silently become this session's target.
    expect(graphTarget(registry, flockInventory(registry, machines), "execution:old")).not.toBeNull();
    machines[1]!.state = "connected"; machines[1]!.snapshot!.flock_bindings![0]!.native_session_id = "reused-native";
    expect(graphTarget(registry, flockInventory(registry, machines), "session:session")).toBeNull();
  });
  it("does not redirect an old unadopted execution selection to a replacement native session", () => {
    const { machines } = source();
    const empty: FlockRegistry = { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
    const before = graphInventory(empty, flockInventory(empty, machines));
    const selected = before.nodes.find((node) => node.kind === "execution" && node.machineId === machines[0]!.id)!;
    expect(graphTarget(empty, flockInventory(empty, machines), selected.id)).not.toBeNull();
    machines[0]!.snapshot!.flock_bindings![0]!.native_session_id = "replacement-native";
    const next = flockInventory(empty, machines);
    expect(graphInventory(empty, next).nodes.some((node) => node.id === selected.id)).toBe(false);
    expect(graphTarget(empty, next, selected.id)).toBeNull();
  });
  it("shows unsupported/unknown sources honestly and never supplies a stale terminal", () => {
    const { registry, machines } = source();
    machines[1]!.snapshot = null; machines[0]!.snapshot!.flock_bindings = [];
    const rows = flockInventory(registry, machines), data = graphInventory(registry, rows);
    expect(data.nodes.find((node) => node.id === "session:session")?.freshness).toBe("unavailable");
    expect(data.nodes.find((node) => node.freshness === "unsupported")).toBeDefined();
    for (const node of data.nodes) expect(graphTarget(registry, rows, node.id)).toBeNull();
    const missing = graphInventory(null, rows);
    expect(missing.edges.some((edge) => edge.kind === "delegation")).toBe(false);
    expect(graphTarget(null, rows, "execution:old")).toBeNull();
  });
});
