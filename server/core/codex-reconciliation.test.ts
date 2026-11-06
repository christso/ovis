import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerMessage, SessionSnapshot } from "../../shared/protocol.ts";
import type { SightingFacts } from "../input-guard.ts";
import type { TerminalSighting } from "./terminals.ts";
import { connectionData, type Client } from "./connections.ts";
import * as codex from "../codex.ts";
import * as herdr from "../herdr/client.ts";
import * as steering from "../codex-steering.ts";
import { createPendingDelivery } from "./pending.ts";

const original = { home: codex.paneCodexHomePlaced, rollout: codex.codexOpenRollout, info: herdr.paneProcessInfo, read: herdr.paneRead, text: herdr.paneSendText, keys: herdr.paneSendKeys, interrupt: steering.interruptCodexSteering };
let path = "", pid = process.pid, loseEnterReply = false, failedIdentityReads = 0, realPlacement = false, infoReads = 0, failInfoAt = -1, missingRollouts = 0;
const writes: string[] = [];
mock.module("../codex.ts", () => ({ ...codex, paneCodexHomePlaced: async (...args: Parameters<typeof original.home>) => realPlacement ? original.home(...args) : { home: "/test-store", placed: true }, codexOpenRollout: async () => { if (missingRollouts > 0) { missingRollouts--; return null; } return path; } }));
mock.module("../herdr/client.ts", () => ({ ...herdr,
  paneProcessInfo: async () => { if (++infoReads === failInfoAt) throw new Error("transient placement lookup failure"); if (failedIdentityReads > 0) { failedIdentityReads--; throw new Error("transient native identity read failure"); } return { shell_pid: 1, foreground_processes: [{ pid, name: "codex", argv: ["codex"] }] }; },
  paneRead: async () => ({ text: "• Working (2s • esc to interrupt)\n› Ask Codex to do anything\n  gpt-6.1 default · /test\n" }),
  paneSendText: async (_pane: string, text: string) => { writes.push(text); },
  paneSendKeys: async (_pane: string, keys: string[]) => { writes.push(keys.join(" ")); if (loseEnterReply) throw new Error("Enter was written but its reply was lost"); },
}));
mock.module("../codex-steering.ts", () => ({ ...steering, interruptCodexSteering: async () => { throw new Error("interruption check timed out after Enter"); } }));
const roots: string[] = [];
afterEach(() => { pid = process.pid; loseEnterReply = false; failedIdentityReads = 0; realPlacement = false; infoReads = 0; failInfoAt = -1; missingRollouts = 0; writes.length = 0; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
afterAll(() => {
  mock.module("../codex.ts", () => ({ ...codex, paneCodexHomePlaced: original.home, codexOpenRollout: original.rollout }));
  mock.module("../herdr/client.ts", () => ({ ...herdr, paneProcessInfo: original.info, paneRead: original.read, paneSendText: original.text, paneSendKeys: original.keys }));
  mock.module("../codex-steering.ts", () => ({ ...steering, interruptCodexSteering: original.interrupt }));
});
const ready: SightingFacts = { attached: true, origin: true, sameAttachment: true, samePty: true, sameClaim: true, claimed: true, member: true, ready: true, held: false, currentHeld: false, mirror: false, cols: 80 };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ovis-codex-reconcile-")); roots.push(root); path = join(root, "rollout.jsonl");
  writeFileSync(path, JSON.stringify({ type: "session_meta", payload: { id: "native-session" } }) + "\n");
  const frames: ServerMessage[] = [], clients = new Set<Client>();
  const owner = { data: connectionData({ deviceId: "device", readOnly: false }), readyState: WebSocket.OPEN,
    getBufferedAmount: () => 0, send: (data: string) => { frames.push(JSON.parse(data)); return 1; } } as Client;
  owner.data.attached.set("p", { keepSize: false, receiptResumeId: "browser" }); clients.add(owner);
  let lane = Promise.resolve<unknown>(undefined);
  const serialize = <T>(_pane: string, task: () => T | Promise<T>): Promise<T> => { const next = lane.catch(() => {}).then(task); lane = next; return next; };
  const delivery = createPendingDelivery({ options: { submitDelayMs: 0 }, clients, attachments: new Map(), serialize, lastTyped: new Map(),
    sight: (): TerminalSighting => ({ origin: null, pty: null, claim: null, facts: () => ready, write: () => {} }),
    submitText: async () => { writes.push("ordinary send"); }, authorizeSocket: () => {},
    clientSnapshot: async () => ({ panes: [{ pane_id: "p", terminal_id: "terminal", agent: "codex", agent_status: "working", cwd: root }] }) as SessionSnapshot,
    omo: { sessionOf: () => null }, SUBMIT_DEADLINE_MS: 45_000, SUBMIT_DELAY_MS: 0, TYPED_SETTLE_MS: 0,
  });
  const queue = async (id: number, text: string) => {
    await delivery.pendingFrames.submit(owner, { type: "submit", id, pane_id: "p", text, payload: text, delivery: "hold" });
    const frame = frames.find((frame) => frame.type === "submit-result" && frame.id === id);
    if (frame?.type !== "submit-result" || !frame.ok || !frame.pending) throw new Error(JSON.stringify(frame));
    return frame.pending;
  };
  const append = (text: string) => appendFileSync(path, JSON.stringify({ type: "event_msg", timestamp: new Date().toISOString(), payload: { type: "user_message", message: text } }) + "\n");
  const steer = async (id: string) => {
    await delivery.pendingFrames["pending-action"](owner, { type: "pending-action", id: 10, pane_id: "p", pending_id: id, action: "steer" });
    await serialize("p", () => {});
  };
  return { delivery, owner, clients, frames, queue, append, steer, barrier: () => serialize("p", () => {}) };
}

describe("a Codex send whose interruption check timed out", () => {
  it("clears the exact warning after its native message appears, leaving held followers and input untouched", async () => {
    const f = fixture(), row = await f.queue(1, "new message"), follower = await f.queue(2, "later");
    await f.steer(row.id);
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: row.id, state: "uncertain" }, { id: follower.id, state: "held" }]);
    const before = [...writes];
    f.append(row.text);
    await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: follower.id, state: "held" }]);
    expect(f.frames.flatMap((frame) => frame.type === "pending-messages" ? frame.removed ?? [] : [])).toContainEqual({ id: row.id, outcome: "consumed" });
    expect(writes).toEqual(before);
  });

  it("replays native confirmation only to the original browser/device after a disconnect", async () => {
    const f = fixture(), row = await f.queue(1, "new message"); await f.steer(row.id);
    f.clients.delete(f.owner); f.delivery.closeConnection(f.owner);
    f.append(row.text); await f.delivery.reconcileCodexDeliveries("p");
    const resumed: ServerMessage[] = [];
    const next = { ...f.owner, data: connectionData({ deviceId: "device", readOnly: false }), send: (value: string) => { resumed.push(JSON.parse(value)); return 1; } } as Client;
    next.data.attached.set("p", { keepSize: false, receiptResumeId: "browser" }); f.clients.add(next);
    f.delivery.attached(next, "p"); await f.barrier();
    expect(resumed.flatMap((frame) => frame.type === "pending-messages" ? frame.removed ?? [] : [])).toContainEqual({ id: row.id, outcome: "consumed", resumed: true });
  });

  it("does not borrow a successful ordinary send's delayed identical echo", async () => {
    const f = fixture();
    await f.delivery.pendingFrames.submit(f.owner, { type: "submit", id: 1, pane_id: "p", text: "repeat", payload: "repeat" });
    const row = await f.queue(2, "repeat"); await f.steer(row.id);
    f.append("repeat"); await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: row.id, state: "uncertain" }]);
  });

  it("reserves an Enter whose acknowledgement was lost before another held identical send", async () => {
    const f = fixture(), first = await f.queue(1, "repeat"), second = await f.queue(2, "repeat");
    loseEnterReply = true; await f.steer(first.id); loseEnterReply = false;
    await f.steer(second.id);
    f.append("repeat"); await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: first.id, state: "uncertain" }, { id: second.id, state: "uncertain" }]);
  });

  it("does not give a terminal-line submission's native record to an uncertain Chat send", async () => {
    const f = fixture(), row = await f.queue(1, "repeat"); await f.steer(row.id);
    await f.delivery.pendingFrames.submit(f.owner, { type: "submit", id: 3, pane_id: "p", text: "repeat", payload: "repeat", typed: true });
    f.append("repeat"); await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: row.id, state: "uncertain" }]);
  });

  it("retries a transient final-append identity failure without another append or reattach", async () => {
    const f = fixture(), row = await f.queue(1, "new message"); await f.steer(row.id);
    f.append(row.text); failedIdentityReads = 1;
    await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toEqual([]);
  });

  it("retries a transient placement failure swallowed by the real home resolver", async () => {
    const f = fixture(), row = await f.queue(1, "new message"); await f.steer(row.id);
    f.append(row.text); realPlacement = true; infoReads = 0; failInfoAt = 3;
    await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toEqual([]);
  });

  it("retries a transient missing rollout, with bounded attempts if it remains unavailable", async () => {
    const f = fixture(), row = await f.queue(1, "new message"); await f.steer(row.id);
    f.append(row.text); missingRollouts = 10;
    await f.delivery.reconcileCodexDeliveries("p");
    expect(missingRollouts).toBe(7);
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: row.id, state: "uncertain" }]);
    missingRollouts = 1;
    await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toEqual([]);
  });

  it("does not reconcile against another process even when its message text matches", async () => {
    const f = fixture(), row = await f.queue(1, "new message"); await f.steer(row.id);
    pid = process.ppid;
    f.append(row.text); await f.delivery.reconcileCodexDeliveries("p");
    expect(f.delivery.pending.list(f.owner, "p")).toMatchObject([{ id: row.id, state: "uncertain" }]);
  });
});
