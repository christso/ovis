import { afterAll, afterEach, beforeAll, expect, it } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { FlockRegistry, HerdrCoordinationEndpoint } from "../../shared/flock.ts";
import type { Machine } from "../../shared/machines.ts";
import { useFlockInventory } from "./flockInventory.ts";

const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let renderer: ReactTestRenderer | null = null;
let rows: ReturnType<typeof useFlockInventory> = [];
let machines: Machine[], sources: Machine[];
const registry: FlockRegistry = { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
const endpoint: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "terminal", agent_instance_id: "occupancy", agent: "claude", pane_id: "w1:p1", name: "Worker" };
const machine = (): Machine => ({ id: "fixture", name: "Fixture", kind: "local", enabled: true, state: "connected", error: null,
  snapshot: { protocol: 1, version: "fixture", agents: [], layouts: [], workspaces: [], tabs: [], herdr_lifetime: "lifetime",
    panes: [{ terminal_id: "terminal", pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", agent: "claude", agent_status: "idle", focused: false, revision: 0 }] } });
function Probe() { rows = useFlockInventory(registry, machines, sources); return null; }
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
