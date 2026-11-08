import { afterAll, afterEach, beforeAll, expect, it, jest } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { FlockRegistry } from "../../shared/flock.ts";
import { nativeTransport, setTransport } from "./transport.ts";
import { useFlock } from "./useFlock.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
let renderer: ReactTestRenderer | null = null;
let latest: ReturnType<typeof useFlock>;
function Probe() { latest = useFlock(true); return null; }
beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms), clearInterval: (timer: ReturnType<typeof setInterval>) => clearInterval(timer),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = null; setTransport(nativeTransport); jest.useRealTimers(); });
afterAll(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
  if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
const registry: FlockRegistry = { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
it("accepts a read slower than the poll interval without starting a competing automatic read", async () => {
  jest.useFakeTimers();
  const first = Promise.withResolvers<Response>(); let calls = 0;
  setTransport({ ...nativeTransport, fetch: async () => { calls += 1; return calls === 1 ? first.promise : Response.json(registry); } });
  await act(async () => { renderer = create(createElement(Probe)); });
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(calls).toBe(1);
  await act(async () => { first.resolve(Response.json(registry)); });
  expect(latest.registry).toEqual(registry);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(calls).toBe(2);
});
it("disables writes after an unreadable format until a supported registry reloads", async () => {
  let future = false; let writes = 0;
  setTransport({ ...nativeTransport, fetch: async (_input, init) => { if (init?.method === "POST") writes += 1; return Response.json(future ? { version: 2 } : registry); } });
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(latest.registry).toEqual(registry);
  future = true;
  await act(async () => { await latest.refresh(); });
  expect(latest.registry).toBeNull();
  await expect(latest.change({ type: "create-work", name: "Do not send" })).rejects.toThrow();
  expect(writes).toBe(0);
  future = false;
  await act(async () => { await latest.refresh(); });
  expect(latest.registry).toEqual(registry);
});

it("keeps ephemeral source proofs out of the registry and clears them when a refresh fails", async () => {
  let unavailable = false;
  const sources = [{ id: "owned-fixture", name: "Owned fixture", kind: "local" as const, enabled: true, state: "connected" as const, error: null, snapshot: null }];
  setTransport({ ...nativeTransport, fetch: async () => unavailable ? new Response("unavailable", { status: 503 }) : Response.json({ ...registry, sources }) });
  await act(async () => { renderer = create(createElement(Probe)); });
  expect(latest.sources).toEqual(sources);
  expect(latest.registry).toEqual(registry);
  unavailable = true;
  await act(async () => { await latest.refresh(); });
  expect(latest.sources).toEqual([]);
});
