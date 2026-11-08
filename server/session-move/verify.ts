import { digest, MoveRefused } from "./files.ts";

export interface NativeMoveRpc { call(method: "thread/read" | "thread/turns/list" | "thread/items/list", params: Record<string, unknown>): Promise<unknown> }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Full native paging, not a UUID-only or first-page resume check. No method starts a model turn. */
export async function nativeHistoryProof(rpc: NativeMoveRpc, threadId: string): Promise<string> {
  const pages = async (method: "thread/turns/list" | "thread/items/list"): Promise<unknown[]> => {
    const all: unknown[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 4096; page++) {
      const answer = object(await rpc.call(method, { threadId, limit: 100, sortDirection: "asc", ...(cursor ? { cursor } : {}) }));
      if (!Array.isArray(answer.data)) throw new MoveRefused("native_history_invalid", "Native Codex history could not be verified");
      all.push(...answer.data);
      if (Buffer.byteLength(JSON.stringify(all)) > 64 * 1024 * 1024) throw new MoveRefused("native_history_too_large", "Native history verification exceeds the supported size");
      if (answer.nextCursor === null) return all;
      if (typeof answer.nextCursor !== "string" || !answer.nextCursor || cursors.has(answer.nextCursor)) throw new MoveRefused("native_history_invalid", "Native Codex history pagination did not advance");
      cursor = answer.nextCursor; cursors.add(cursor);
    }
    throw new MoveRefused("native_history_too_large", "Native history verification exceeds the supported page limit");
  };
  const turns = await pages("thread/turns/list"), items = await pages("thread/items/list");
  return digest(Buffer.from(JSON.stringify(canonical({ turns, items }))));
}

export async function verifyNativeResume(rpc: NativeMoveRpc, expected: { thread_id: string; session_id: string; cwd: string; rollout: string; history: string }): Promise<void> {
  const thread = object(object(await rpc.call("thread/read", { threadId: expected.thread_id, includeTurns: false })).thread);
  if (thread.id !== expected.thread_id || thread.sessionId !== expected.session_id || thread.cwd !== expected.cwd || thread.path !== expected.rollout
    || !["idle", "active"].includes(object(thread.status).type as string)) throw new MoveRefused("resume_mismatch", "Destination has not loaded the requested native Codex session");
  if (await nativeHistoryProof(rpc, expected.thread_id) !== expected.history) throw new MoveRefused("resume_history_mismatch", "Destination native history differs from the source snapshot");
}
