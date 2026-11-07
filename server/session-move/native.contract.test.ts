/** Opt-in installed-CLI qualification: disposable homes, no inherited credentials, no turn/start. */
import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreCodex, restoreCodexHistory, snapshotCodex } from "./codex.ts";
import { nativeHistoryProof, verifyNativeResume } from "./verify.ts";
import { holdQuiescentCodex } from "./quiescence.ts";

const ENABLED = process.env["OVIS_CODEX_MOVE_NATIVE_TEST"] === "1";
const THREAD = "019a5a00-0000-7000-8000-000000000001";
const SEGMENT = "019a5a00-0000-7000-8000-000000000002";
const TURN = "019a5a00-0000-7000-8000-000000000099";
const jsonl = (values: unknown[]): string => values.map((item) => JSON.stringify(item) + "\n").join("");

async function fixtureNative(cli: string, root: string, home: string) {
  const native = Bun.spawn([cli, "app-server", "--stdio"], {
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: root, CODEX_HOME: home, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state") },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const pending = new Map<number, { resolve(value: any): void; reject(reason: unknown): void }>();
  let next = 0;
  const reading = (async () => {
    let buffer = "";
    for await (const chunk of native.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const answer = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        const waiter = pending.get(answer.id);
        if (waiter) { pending.delete(answer.id); if (answer.error) waiter.reject(new Error(JSON.stringify(answer.error))); else waiter.resolve(answer.result); }
      }
    }
    for (const waiter of pending.values()) waiter.reject(new Error("Owned native app server exited"));
  })();
  function call(method: string, params: unknown): Promise<any> {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Owned native fixture RPC timed out")); }, 15_000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
      native.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  const close = async () => { native.stdin.end(); native.kill(); await native.exited; await reading; };
  try {
    const initialized = await call("initialize", { clientInfo: { name: "ovis_move_fixture", title: "Owned transfer fixture", version: "1" }, capabilities: null });
    expect(initialized.codexHome).toBe(home);
    native.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    return { call, close };
  } catch (error) { await close(); throw error; }
}

it.skipIf(!ENABLED)("native Codex 0.166.0 resumes transferred paginated history and its scoped index without credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-move-native-"));
  const home = join(root, "source"), destination = join(root, "destination"), staging = join(root, "snapshot"), cwd = join(root, "checkout");
  for (const path of [home, destination, staging, cwd]) mkdirSync(path);
  const day = "sessions/2026/11/07";
  mkdirSync(join(home, day), { recursive: true });
  const base = `${day}/rollout-2026-11-07T01-00-00-${THREAD}.jsonl`;
  const tail = `${day}/rollout-2026-11-07T01-00-01-${THREAD}_${SEGMENT}.jsonl`;
  const stamp = "2026-11-07T01:00:00.000Z";
  const record = (ordinal: number, type: string, payload: unknown) => ({ timestamp: stamp, ordinal, type, payload });
  const meta = { id: THREAD, session_id: THREAD, timestamp: stamp, cwd, cli_version: "0.166.0", originator: "codex_cli_rs", source: "cli", model_provider: "openai", history_mode: "paginated" };
  const prefix = jsonl([
    record(0, "session_meta", meta),
    record(1, "event_msg", { type: "task_started", turn_id: TURN, model_context_window: 10000 }),
    record(2, "event_msg", { type: "user_message", message: "Owned inherited transfer fixture", images: [], local_images: [], text_elements: [] }),
    record(3, "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "Owned inherited transfer fixture" }] }),
    record(4, "event_msg", { type: "item_completed", thread_id: THREAD, turn_id: TURN, item: { type: "UserMessage", id: "owned-user", content: [{ type: "text", text: "Owned inherited transfer fixture", text_elements: [] }] }, started_at_ms: 1794013200000, completed_at_ms: 1794013200000 }),
    record(5, "event_msg", { type: "agent_message", message: "Owned inherited answer" }),
    record(6, "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Owned inherited answer" }] }),
    record(7, "event_msg", { type: "item_completed", thread_id: THREAD, turn_id: TURN, item: { type: "AgentMessage", id: "owned-answer", content: [{ type: "Text", text: "Owned inherited answer" }], phase: "final_answer" }, started_at_ms: 1794013200000, completed_at_ms: 1794013200000 }),
    record(8, "event_msg", { type: "task_complete", turn_id: TURN, last_agent_message: "Owned inherited answer" }),
  ]);
  writeFileSync(join(home, base), prefix);
  let destinationNative: Awaited<ReturnType<typeof fixtureNative>> | undefined;
  let lease: ReturnType<typeof holdQuiescentCodex> | undefined;
  let sourceHistory = "";
  try {
    const cli = Bun.which("codex"); expect(cli).not.toBeNull();
    expect(Bun.spawnSync([cli!, "--version"]).stdout.toString().trim()).toBe("codex-cli 0.166.0");
    const sourceNative = await fixtureNative(cli!, root, home);
    try {
      await sourceNative.call("thread/resume", { threadId: THREAD, cwd, excludeTurns: true });
      const turns = await sourceNative.call("thread/turns/list", { threadId: THREAD, limit: 10 });
      expect(turns.data.map((turn: { id: string }) => turn.id)).toContain(TURN);
      sourceHistory = await nativeHistoryProof(sourceNative, THREAD);
      const originalItems = await sourceNative.call("thread/items/list", { threadId: THREAD, turnId: TURN, limit: 100 });
      expect(JSON.stringify(originalItems)).toContain("Owned inherited transfer fixture");
    } finally { await sourceNative.close(); }
    writeFileSync(join(home, tail), jsonl([record(9, "session_meta", { ...meta, history_base: { thread_id: THREAD, end_ordinal_exclusive: 9, end_byte_offset: Buffer.byteLength(prefix) } })]));
    lease = holdQuiescentCodex(home, THREAD);
    const snapshot = snapshotCodex(home, tail, THREAD, staging);
    restoreCodex(snapshot, staging, destination, cwd);
    destinationNative = await fixtureNative(cli!, root, destination);
    // Native paging initializes/materializes its own current schema without starting a turn.
    await destinationNative.call("thread/turns/list", { threadId: THREAD, limit: 10 });
    restoreCodexHistory(snapshot, staging, destination);
    const resumed = await destinationNative.call("thread/resume", { threadId: THREAD, cwd, excludeTurns: true });
    expect(resumed.thread.id).toBe(THREAD);
    expect(resumed.thread.sessionId).toBe(THREAD);
    expect(resumed.thread.cwd).toBe(cwd);
    expect(resumed.thread.status.type).toBe("idle");
    expect(resumed.thread.path).toBe(join(destination, tail));
    const turns = await destinationNative.call("thread/turns/list", { threadId: THREAD, limit: 10 });
    expect(turns.data.map((turn: { id: string }) => turn.id)).toContain(TURN);
    const items = await destinationNative.call("thread/items/list", { threadId: THREAD, turnId: TURN, limit: 100 });
    expect(JSON.stringify(items)).toContain("Owned inherited transfer fixture");
    expect(JSON.stringify(items)).toContain("Owned inherited answer");
    await verifyNativeResume(destinationNative, { thread_id: THREAD, session_id: THREAD, cwd, rollout: join(destination, tail), history: sourceHistory });
    lease.assertHeld(); expect(() => holdQuiescentCodex(home, THREAD)).toThrow("native Codex client");
    expect(readFileSync(join(home, base), "utf8").startsWith(prefix)).toBe(true);
  } finally {
    await destinationNative?.close(); lease?.release(); rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
