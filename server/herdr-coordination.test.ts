import { afterEach, expect, it, spyOn } from "bun:test";
import type { HerdrCoordinationEndpoint, HerdrCoordinationPage, HerdrCoordinationReceipt } from "../shared/flock.ts";
import * as herdr from "./herdr/client.ts";
import { herdrCoordinationSnapshot } from "./herdr-coordination.ts";

const source: HerdrCoordinationEndpoint = { server_id: "server", boot_id: "boot", terminal_id: "source-terminal", agent_instance_id: "source-occupancy", agent: "claude", pane_id: "w1:p1", name: "Coordinator" };
const target = { ...source, terminal_id: "target-terminal", agent_instance_id: "target-occupancy", agent: "codex", pane_id: "w2:p1", name: "Worker" };
const receipt = (id: string): HerdrCoordinationReceipt => ({ id, kind: "communication", source, target, occurred_at: "2026-11-08T00:00:00Z" });
const page = (receipts: HerdrCoordinationReceipt[], cursor: string | null = null): HerdrCoordinationPage => ({ version: 1, server_id: "server", boot_id: "boot", agents: [source, target], receipts, cursor });
let reader: ReturnType<typeof spyOn> | undefined;
afterEach(() => { reader?.mockRestore(); reader = undefined; });

it("advances bounded daemon pages and finds later appends by rereading only the tail", async () => {
  const requests: (string | undefined)[] = [];
  const history = Array.from({ length: 2100 }, (_, index) => receipt(String(index)));
  reader = spyOn(herdr, "agentCoordinationList").mockImplementation(async (cursor) => {
    requests.push(cursor);
    const offset = Number(cursor ?? 0), end = Math.min(offset + 500, history.length);
    return page(history.slice(offset, end), end < history.length ? String(end) : null) as never;
  });
  const first = await herdrCoordinationSnapshot("fixture-many-pages");
  expect(first?.receipts).toHaveLength(2000);
  expect(first?.cursor).toBe("2000");
  const second = await herdrCoordinationSnapshot("fixture-many-pages");
  expect(second?.receipts).toHaveLength(2100);
  history.push(receipt("appended"));
  const third = await herdrCoordinationSnapshot("fixture-many-pages");
  expect(third?.receipts).toHaveLength(2101);
  expect(requests).toEqual([undefined, "500", "1000", "1500", "2000", "2000"]);
});

it("does not lose a page after transport failure and never exposes message content", async () => {
  let fail = false;
  const raw = { ...receipt("one"), message: "private prompt", source: { ...source, prompt: "private source" } };
  reader = spyOn(herdr, "agentCoordinationList").mockImplementation(async () => {
    if (fail) throw new Error("fixture transport failure");
    return page([raw]) as never;
  });
  expect((await herdrCoordinationSnapshot("fixture-retry"))?.receipts).toHaveLength(1);
  fail = true;
  expect(await herdrCoordinationSnapshot("fixture-retry")).toBeUndefined();
  fail = false;
  const restored = await herdrCoordinationSnapshot("fixture-retry");
  expect(restored?.receipts).toHaveLength(1);
  expect(JSON.stringify(restored)).not.toContain("private");
});

it("restarts a stale cursor when the daemon changes and rejects malformed future pages", async () => {
  let boot = "boot", malformed = false;
  const requests: (string | undefined)[] = [];
  reader = spyOn(herdr, "agentCoordinationList").mockImplementation(async (cursor) => {
    requests.push(cursor);
    if (malformed) return { ...page([]), version: 2 } as never;
    const agents = [source, target].map((item) => ({ ...item, boot_id: boot }));
    return { ...page([receipt(boot)], requests.length < 4 ? String(requests.length * 500) : null), boot_id: boot, agents } as never;
  });
  await herdrCoordinationSnapshot("fixture-restart");
  boot = "replacement";
  const replaced = await herdrCoordinationSnapshot("fixture-restart");
  expect(replaced?.boot_id).toBe("replacement");
  expect(replaced?.receipts.map((item) => item.id)).toEqual(["replacement"]);
  expect(requests.slice(4)).toEqual(["1500", undefined]);
  malformed = true;
  expect(await herdrCoordinationSnapshot("fixture-restart")).toBeUndefined();
});
