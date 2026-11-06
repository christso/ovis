import { describe, expect, it } from "bun:test";
import type { ConversationTurn, PendingMessage, ServerMessage } from "../../shared/protocol.ts";
import { capturePendingAttempt, completePendingAttempt, forgetPendingAttempt, forgetPendingTranscript, forgetMachinePendingTranscript, observePendingTranscript, pendingTranscriptMatches } from "./pendingTranscript.ts";
import { currentWaitingSends, forgetWaitingSends, rememberWaitingSend, settleWaitingSends, waitingBaseline, waitingKey } from "./sentWaiting.ts";
import { MachineSession } from "./machineSession.ts";
import { PendingMessageStore } from "./pendingMessages.ts";
import { paneStorageId } from "../../shared/machines.ts";
import type { HerdrSocket } from "./ws.ts";

const user = (text: string, at: number): ConversationTurn => ({ role: "user", ts: new Date(at).toISOString(), parts: [{ kind: "text", text }] });
const row = (id = "a", text = "repeat"): PendingMessage => ({ id, text, state: "uncertain", request_id: 1, created_at: new Date(3000).toISOString(), error: { code: "submit_changed", message: "unknown" } });
let next = 0;
function scenario(run: (key: string) => void): void {
  const key = waitingKey("pending-review-test", String(++next));
  try {
    settleWaitingSends(key, [user("earlier", 1001)], 1500, true);
    observePendingTranscript(key, "native-history");
    run(key);
  } finally { forgetWaitingSends(key); forgetPendingTranscript(key); }
}

describe("a pending recovery copy beside its native transcript", () => {
  it("matches one uncertain copy to its unique new turn, without changing the pending row", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 3000);
    const message = row();
    expect(pendingTranscriptMatches(key, "native-history", [message], [user("earlier", 1001), user("repeat", 4001)])).toEqual(new Map([[1, "a"]]));
    expect(message.state).toBe("uncertain");
    expect(message.error?.code).toBe("submit_changed");
  }));

  it("forgets matching evidence across a lost PC connection", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 3000);
    forgetMachinePendingTranscript("pending-review-test");
    observePendingTranscript(key, "native-history");
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 4001)])).toEqual(new Map());
  }));

  it("does not attach to an older identical message, including one first read after sending", () => scenario((key) => {
    settleWaitingSends(key, [user("repeat", 1001)], 1500, true);
    capturePendingAttempt(key, "a", "repeat", 4000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 1001), user("repeat", 2001)])).toEqual(new Map());
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 1001), user("repeat", 5001)])).toEqual(new Map([[1, "a"]]));
  }));

  it("does not count an aged baseline's idle time as proof that an unread old echo is this send", () => scenario((key) => {
    settleWaitingSends(key, [user("earlier", 1000)], 10_000, true);
    capturePendingAttempt(key, "a", "repeat", 20_000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("earlier", 1000), user("repeat", 15_000)])).toEqual(new Map());
  }));

  it("keeps recovery folded when a browser-ahead clock cannot establish a new echo", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 5000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 4801)])).toEqual(new Map());
  }));

  it("leaves identical concurrent attempts and multiple possible new turns compact", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 4001), user("repeat", 5001)])).toEqual(new Map());
    capturePendingAttempt(key, "b", "repeat", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row(), row("b")], [user("repeat", 4001)])).toEqual(new Map());
  }));

  it("does not reuse a completed send's echo for an uncertain one", () => scenario((key) => {
    capturePendingAttempt(key, "sent", "repeat", 3000);
    completePendingAttempt(key, "sent");
    capturePendingAttempt(key, "a", "repeat", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 4001)])).toEqual(new Map());
  }));

  it("reserves an ordinary confirmed send's echo before and after settlement", () => scenario((key) => {
    rememberWaitingSend(key, "repeat", 3000, waitingBaseline(key));
    capturePendingAttempt(key, "a", "repeat", 3500);
    const turns = [user("earlier", 1001), user("repeat", 3401)];
    expect(pendingTranscriptMatches(key, "native-history", [row()], turns)).toEqual(new Map());
    settleWaitingSends(key, turns, 4000, true);
    expect(currentWaitingSends(key)).toHaveLength(0);
    expect(pendingTranscriptMatches(key, "native-history", [row()], turns)).toEqual(new Map());
  }));

  it("keeps an unread older identical turn compact when its timestamp has second precision", () => scenario((key) => {
    settleWaitingSends(key, [user("earlier", 1000)], 1500, true);
    capturePendingAttempt(key, "a", "repeat", 2500);
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("earlier", 1000), user("repeat", 2000)])).toEqual(new Map());
  }));

  it("requires the same PC, pane and native history, and a pre-send baseline", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 3000);
    const turns = [user("repeat", 4001)];
    for (const other of [waitingKey("other-PC", "1"), waitingKey("pending-review-test", "other-pane")]) expect(pendingTranscriptMatches(other, "native-history", [row()], turns)).toEqual(new Map());
    expect(pendingTranscriptMatches(key, "other-history", [row()], turns)).toEqual(new Map());
    expect(pendingTranscriptMatches(key, undefined, [row()], turns)).toEqual(new Map());
    observePendingTranscript(key, "other-history");
    expect(pendingTranscriptMatches(key, "native-history", [row()], turns)).toEqual(new Map());
    forgetPendingTranscript(key); forgetWaitingSends(key);
    observePendingTranscript(key, "native-history"); capturePendingAttempt(key, "a", "repeat", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row()], turns)).toEqual(new Map());
  }));

  it("ignores invalid dates, assistant echoes, commands, changed words and unsent followers", () => scenario((key) => {
    capturePendingAttempt(key, "a", "repeat", 3000);
    const turns = [{ ...user("repeat", 4001), ts: null }, { ...user("repeat", 4001), ts: "invalid" }, { ...user("repeat", 4001), role: "assistant" as const }, user("repeat please", 4001)];
    expect(pendingTranscriptMatches(key, "native-history", [row()], turns)).toEqual(new Map());
    expect(pendingTranscriptMatches(key, "native-history", [{ ...row(), state: "held" }], [user("repeat", 4001)])).toEqual(new Map());
    forgetPendingAttempt(key, "a");
    expect(pendingTranscriptMatches(key, "native-history", [row()], [user("repeat", 4001)])).toEqual(new Map());
    capturePendingAttempt(key, "cmd", "/cost", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row("cmd", "/cost")], [user("/cost", 4001)])).toEqual(new Map());
  }));

  it("uses the existing terminal normalization without equating different internal spaces", () => scenario((key) => {
    capturePendingAttempt(key, "a", "one\ntwo", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row("a", "one\ntwo")], [user("one  \r\ntwo", 4001)])).toEqual(new Map([[0, "a"]]));
    capturePendingAttempt(key, "a", "change a b", 3000);
    expect(pendingTranscriptMatches(key, "native-history", [row("a", "change a b")], [user("change ab", 4001)])).toEqual(new Map());
  }));

  it("captures the connection's sending frame before an immediate uncertain frame and leaves server ownership intact", () => {
    const machine = "connection-review", pane = "same-pane", key = waitingKey(machine, pane);
    const handlers: ((message: ServerMessage) => void)[] = [];
    const socket = { connected: true, on: (handler: (message: ServerMessage) => void) => { handlers.push(handler); return () => {}; }, onDisconnect: () => () => {}, trustFeatures: () => {}, connect: () => {}, close: () => {}, setPresence: () => {} };
    const data = new Map<string, string>();
    const store = new PendingMessageStore(() => ({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } }));
    const session = new MachineSession(machine, { socket: socket as unknown as HerdrSocket, pendingStore: store });
    const receive = (message: ServerMessage) => handlers.forEach((handler) => handler(message));
    try {
      receive({ type: "snapshot", snapshot: { version: "test", protocol: 22, workspaces: [], tabs: [], panes: [], agents: [], layouts: [] } });
      settleWaitingSends(key, [user("earlier", Date.now() - 10_000)], Date.now() - 500, true);
      observePendingTranscript(key, "native-history");
      receive({ type: "pending-messages", pane_id: pane, messages: [{ ...row(), state: "sending" }] });
      receive({ type: "pending-messages", pane_id: pane, messages: [row()] });
      const owner = paneStorageId(machine, pane), before = store.read(owner);
      expect(pendingTranscriptMatches(key, "native-history", before, [user("repeat", Date.now() + 1)])).toEqual(new Map([[0, "a"]]));
      expect(store.read(owner)).toBe(before);
      expect(before[0]).toMatchObject({ state: "uncertain", serverOwned: true });
      expect(store.isOwned(owner, "a", session.scope)).toBe(true);
    } finally { session.close(); forgetWaitingSends(key); forgetPendingTranscript(key); }
  });
});
