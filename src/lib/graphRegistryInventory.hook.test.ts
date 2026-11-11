import { afterAll, afterEach, beforeAll, expect, it } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { GraphRegistry, HerdrCoordinationEndpoint } from "../../shared/graph-registry.ts";
import type { Machine } from "../../shared/machines.ts";
import { useGraphRegistryInventory } from "./graphRegistryInventory.ts";

const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let renderer: ReactTestRenderer | null = null;
let rows: ReturnType<typeof useGraphRegistryInventory> = [];
let machines: Machine[], sources: Machine[];
const registry: GraphRegistry = { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
const endpoint: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "terminal", agent_instance_id: "occupancy", agent: "claude", pane_id: "w1:p1", name: "Worker" };
const machine = (): Machine => ({ id: "fixture", name: "Fixture", kind: "local", enabled: true, state: "connected", error: null,
  snapshot: { protocol: 1, version: "fixture", agents: [], layouts: [], workspaces: [], tabs: [], herdr_lifetime: "lifetime",
    panes: [{ terminal_id: "terminal", pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", agent: "claude", agent_status: "idle", focused: false, revision: 0 }] } });
function Probe() { rows = useGraphRegistryInventory(registry, machines, sources); return null; }
beforeAll(() => Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true }));
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = null; });
afterAll(() => { if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

it("carries private current daemon occupancy into shared Table and Graph rows", async () => {
  machines = [machine()]; sources = [machine()];
  sources[0]!.snapshot!.flock_coordination = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(rows[0]?.herdr_endpoint).toEqual(endpoint);
  expect(rows[0]?.binding).toBeNull();
  sources = [];
  await act(async () => renderer!.update(createElement(Probe)));
  expect(rows[0]?.herdr_endpoint).toBeNull();
});

for (const replacement of ["lifetime", "terminal", "agent", "disconnected"] as const) it(`rejects private occupancy after the roster's ${replacement} changes`, async () => {
  machines = [machine()]; sources = [machine()];
  sources[0]!.snapshot!.flock_coordination = { version: 1, server_id: "server", boot_id: "boot", agents: [endpoint], receipts: [], cursor: null };
  if (replacement === "lifetime") machines[0]!.snapshot!.herdr_lifetime = "replacement";
  if (replacement === "terminal") machines[0]!.snapshot!.panes[0]!.terminal_id = "replacement";
  if (replacement === "agent") machines[0]!.snapshot!.panes[0]!.agent = "codex";
  if (replacement === "disconnected") sources[0]!.state = "disconnected";
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(rows[0]?.herdr_endpoint).toBeNull();
});


it("uses validated optional CLI process proof without creating a native binding or retaining it across boots", async () => {
  machines = [machine()]; sources = [machine()];
  const current = { ...endpoint, boot_id: sources[0]!.snapshot!.herdr_lifetime! };
  sources[0]!.snapshot!.graph_cli = { version: 1, server_id: current.server_id, boot_id: current.boot_id, current_agents: [current], receipts: [] };
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(rows[0]?.herdr_endpoint).toEqual(current);
  expect(rows[0]?.binding).toBeNull();
  sources[0]!.snapshot!.graph_cli.current_agents = [current, current];
  sources = [...sources];
  await act(async () => renderer!.update(createElement(Probe)));
  expect(rows[0]?.herdr_endpoint).toBeNull();
  sources[0]!.snapshot!.graph_cli.current_agents = [{ ...current, server_id: "other" }];
  sources = [...sources];
  await act(async () => renderer!.update(createElement(Probe)));
  expect(rows[0]?.herdr_endpoint).toBeNull();
  sources[0]!.snapshot!.graph_cli.current_agents = [current];
  machines[0]!.snapshot!.herdr_lifetime = "replacement"; machines = [...machines];
  await act(async () => renderer!.update(createElement(Probe)));
  expect(rows[0]?.herdr_endpoint).toBeNull();
});
