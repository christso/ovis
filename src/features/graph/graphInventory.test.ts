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
