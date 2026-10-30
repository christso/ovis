import { expect, it } from "bun:test";
import { PendingReceipts } from "./pending-receipts.ts";

it("keeps exact dispositions within their pane, browser and device owner, without message text", () => {
  const history = new PendingReceipts();
  const owner = JSON.stringify(["device", "browser"]);
  history.remember("p", owner, [{ id: "one", outcome: "sent" }, { id: "two", outcome: "discarded" }]);
  expect(history.read("p", owner)).toEqual([
    { id: "one", outcome: "sent", resumed: true }, { id: "two", outcome: "discarded", resumed: true },
  ]);
  expect(history.read("other", owner)).toEqual([]);
  expect(history.read("p", JSON.stringify(["device", "other"]))).toEqual([]);
  expect(history.read("p", JSON.stringify(["other", "browser"]))).toEqual([]);
  const snapshot = history.read("p", owner);
  snapshot[0]!.id = "changed";
  expect(history.read("p", owner)[0]!.id).toBe("one");
  history.forget("p");
  expect(history.read("p", owner)).toEqual([]);
});

it("expires outcomes and caps retained identities without treating missing receipts as delivered", () => {
  let now = 1000;
  const history = new PendingReceipts(() => now, 100, 2);
  history.remember("p", "owner", [{ id: "one", outcome: "sent" }]);
  now += 50;
  history.remember("p", "owner", [{ id: "two", outcome: "discarded" }]);
  now += 50;
  expect(history.read("p", "owner").map(x => x.id)).toEqual(["two"]);
  history.remember("p", "owner", [{ id: "three", outcome: "sent" }, { id: "four", outcome: "sent" }]);
  expect(history.read("p", "owner").map(x => x.id)).toEqual(["three", "four"]);
  now += 100;
  expect(history.read("p", "owner")).toEqual([]);
});
