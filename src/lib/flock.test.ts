import { afterEach, expect, it } from "bun:test";
import { fetchFlock } from "./flock.ts";
import { nativeTransport, setTransport } from "./transport.ts";

afterEach(() => setTransport(nativeTransport));
it("rejects a future or malformed API registry before it reaches the application inventory", async () => {
  for (const value of [{ version: 2, revision: 1, works: [], sessions: [], checkouts: [], executions: [] }, { version: 1, revision: 1 },
    { version: 1, revision: 1, works: [], sessions: [{ id: "session", name: "Work", work_id: "missing", current_execution_id: null }], checkouts: [], executions: [] }]) {
    setTransport({ ...nativeTransport, fetch: async () => Response.json(value) });
    await expect(fetchFlock()).rejects.toMatchObject({ code: "flock_unreadable" });
  }
});
it("accepts the supported empty manager registry", async () => {
  const value = { version: 1 as const, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
  setTransport({ ...nativeTransport, fetch: async () => Response.json(value) });
  expect(await fetchFlock()).toEqual(value);
});
