import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMoveDestination, SessionMovePlan } from "../../shared/session-move.ts";
import { MoveRefused } from "./files.ts";
import { MoveJournal } from "./journal.ts";
import { SessionMoves, type MovePorts } from "./move.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const request = { session_id: "logical", source_execution_id: "execution-1", destination_machine_id: "dest", destination_checkout: "/work/moved", untracked_files: [] };
const plan: SessionMovePlan = { request, source_machine_id: "source", native_thread_id: "native-thread", source_checkout: "/work/source", files: [], exclusions: ["Credentials"], fingerprint: "preview-hash" };
const destination: SessionMoveDestination = { machine_id: "dest", herdr_lifetime: "boot-2", pane_id: "owned:p0", native_session_id: "native-thread", checkout: "/work/moved", history_sha256: "history-hash" };
function setup(overrides: Partial<MovePorts> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ovis-move-journal-")); roots.push(dir);
  const journal = new MoveJournal(dir), calls: string[] = [];
  let held = false;
  const ports: MovePorts = {
    preview: async () => structuredClone(plan),
    preflight: async () => { calls.push("preflight"); },
    quiesce: async () => { calls.push("quiesce"); held = true; return { thread_id: "native-thread", assertHeld() { if (!held) throw new Error("lost"); }, release() { held = false; calls.push("release"); } }; },
    snapshot: async () => { expect(held).toBe(true); expect(journal.list()[0]!.phase).toBe("snapshotting"); calls.push("snapshot"); return { id: "owned-snapshot", sha256: "history-hash" }; },
    restore: async () => { expect(held).toBe(true); expect(journal.list()[0]!.phase).toBe("restoring"); calls.push("restore"); },
    launch: async () => { expect(held).toBe(true); expect(journal.list()[0]!.phase).toBe("launching"); calls.push("launch"); },
    inspect: async () => { calls.push("inspect"); return { state: "resumed", destination }; },
    bind: async () => { expect(journal.list()[0]!.phase).toBe("binding"); calls.push("bind"); },
    ...overrides,
  };
  return { dir, journal, ports, calls, moves: new SessionMoves(journal, ports) };
}

describe("planned transfer recovery", () => {
  it("writes intent before every side effect and binds only after verified native resume", async () => {
    const { moves, journal, calls } = setup();
    const item = await moves.preview(request);
    const complete = await moves.run(item.id, item.plan.fingerprint);
    expect(complete.phase).toBe("complete");
    expect(calls).toEqual(["preflight", "quiesce", "snapshot", "restore", "launch", "inspect", "bind", "release"]);
    expect(journal.get(item.id).destination).toEqual(destination);
    await moves.run(item.id, item.plan.fingerprint);
    expect(calls.filter((name) => name === "launch")).toHaveLength(1);
  });
  it("refuses stale previews and destination conflicts before quiescing", async () => {
    const { moves, calls } = setup({ preflight: async () => { throw new MoveRefused("destination_conflict", "Destination exists"); } });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, "stale")).rejects.toThrow("current transfer preview");
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("Destination exists");
    expect(calls).toEqual([]);
  });
  it("refuses busy source without creating any snapshot or destination execution", async () => {
    const { moves, calls, journal } = setup({ quiesce: async () => { throw new MoveRefused("source_not_quiescent", "Native thread is still loaded"); } });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("still loaded");
    expect(calls).toEqual(["preflight"]);
    expect(journal.get(item.id).snapshot).toBeNull();
    expect(journal.get(item.id).error).toBe("source_not_quiescent");
  });
  it("retries failed restore from the durable snapshot after restart", async () => {
    let failure = true;
    const { moves, journal, ports, calls, dir } = setup({ restore: async () => { calls.push("restore"); if (failure) throw new Error("fixture transport failure containing private diagnostic"); } });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("fixture transport failure");
    expect(journal.get(item.id).phase).toBe("restoring");
    expect(readFileSync(join(dir, "session-moves.json"), "utf8")).not.toContain("private diagnostic");
    failure = false;
    const restarted = new SessionMoves(new MoveJournal(dir), ports);
    expect((await restarted.run(item.id, item.plan.fingerprint)).phase).toBe("complete");
    expect(calls.filter((name) => name === "snapshot")).toHaveLength(1);
    expect(calls.filter((name) => name === "launch")).toHaveLength(1);
  });
  it("reconciles an ambiguous launch instead of launching a duplicate", async () => {
    const { moves, journal, ports, calls, dir } = setup({ launch: async () => { calls.push("launch"); throw new Error("connection lost after native launch"); } });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("connection lost");
    expect(journal.get(item.id).phase).toBe("launching");
    const restarted = new SessionMoves(new MoveJournal(dir), ports);
    expect((await restarted.run(item.id, item.plan.fingerprint)).phase).toBe("complete");
    expect(calls.filter((name) => name === "launch")).toHaveLength(1);
  });
  for (const state of ["absent", "pending", "unknown"] as const) {
    it(`leaves ${state} destination launch unresolved and never replays input`, async () => {
      const { moves, journal, calls } = setup({ inspect: async () => ({ state }) });
      const item = await moves.preview(request);
      await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("not verified");
      await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("not verified");
      expect(journal.get(item.id).phase).toBe("verifying");
      expect(calls.filter((name) => name === "launch")).toHaveLength(1);
      expect(calls).not.toContain("bind");
      expect(() => moves.cancel(item.id)).toThrow("Reconcile");
    });
  }
  it("never binds a fresh thread or mismatched snapshot presented as a native resume", async () => {
    const { moves, calls } = setup({ inspect: async () => ({ state: "resumed", destination: { ...destination, native_session_id: "different-native-thread" } }) });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("requested native session");
    expect(calls).not.toContain("bind");
  });
  it("reconciles a registry commit after crash without resuming or snapshotting again", async () => {
    let committed = false;
    const { moves, calls, journal, ports, dir } = setup({ bind: async () => { calls.push("bind"); if (!committed) { committed = true; throw new Error("crash after idempotent binding commit"); } } });
    const item = await moves.preview(request);
    await expect(moves.run(item.id, item.plan.fingerprint)).rejects.toThrow("crash after");
    expect(journal.get(item.id).phase).toBe("binding");
    expect((await new SessionMoves(new MoveJournal(dir), ports).run(item.id, item.plan.fingerprint)).phase).toBe("complete");
    expect(calls.filter((name) => name === "quiesce")).toHaveLength(1);
    expect(calls.filter((name) => name === "launch")).toHaveLength(1);
    expect(calls.filter((name) => name === "bind")).toHaveLength(2);
  });
  it("serializes moves for one logical session and permits cancellation before launch", async () => {
    const { moves } = setup();
    const item = await moves.preview(request);
    await expect(moves.preview(request)).rejects.toThrow("move in progress");
    expect(moves.cancel(item.id).phase).toBe("cancelled");
    expect((await moves.preview(request)).phase).toBe("preview");
  });
  it("preserves unknown and corrupt journals and refuses to overwrite them", async () => {
    const { journal, dir } = setup();
    for (const text of ['{"version":2,"moves":[]}', 'not valid JSON', '{"version":1,"moves":[{}]}']) {
      writeFileSync(join(dir, "session-moves.json"), text);
      expect(() => journal.list()).toThrow(MoveRefused);
      expect(readFileSync(join(dir, "session-moves.json"), "utf8")).toBe(text);
    }
  });
});

it("never acknowledges an oversized journal write that would make recovery unreadable", async () => {
  const { moves, journal, ports } = setup();
  const first = await moves.preview(request);
  moves.cancel(first.id);
  ports.preview = async () => ({ ...structuredClone(plan), files: Array.from({ length: 4500 }, (_, index) => ({ path: `${index}-${"x".repeat(900)}`, bytes: 1, kind: "tracked" as const })) });
  await expect(moves.preview(request)).rejects.toThrow("journal is full");
  expect(journal.list()).toHaveLength(1);
  expect(journal.get(first.id).phase).toBe("cancelled");
});
