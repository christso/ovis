import { expect, it } from "bun:test";
import { nativeHistoryProof, verifyNativeResume, type NativeMoveRpc } from "./verify.ts";
const expected = { thread_id: "owned-thread", session_id: "owned-session", cwd: "/work/moved", rollout: "/owned/session.jsonl", history: "" };
function rpc(secondPage = "inherited"): NativeMoveRpc {
  return { async call(method, params) {
    if (method === "thread/read") return { thread: { id: expected.thread_id, sessionId: expected.session_id, cwd: expected.cwd, path: expected.rollout, status: { type: "idle" } } };
    if (method === "thread/turns/list") return { data: [{ id: "owned-turn", status: "completed" }], nextCursor: null };
    return params.cursor ? { data: [{ id: "previous", text: secondPage }], nextCursor: null }
      : { data: [{ id: "latest", text: "continued" }], nextCursor: "owned-next" };
  } };
}
it("verifies native identity, selected rollout and complete paginated history", async () => {
  const history = await nativeHistoryProof(rpc(), expected.thread_id);
  await expect(verifyNativeResume(rpc(), { ...expected, history })).resolves.toBeUndefined();
  await expect(verifyNativeResume(rpc("lost history"), { ...expected, history })).rejects.toThrow("history differs");
  await expect(verifyNativeResume(rpc(), { ...expected, thread_id: "fresh-thread", history })).rejects.toThrow("requested native");
});
it("rejects missing, looping and malformed native history pages", async () => {
  for (const answer of [{ data: [], nextCursor: "same" }, { data: [], nextCursor: undefined }, { data: "malformed", nextCursor: null }]) {
    await expect(nativeHistoryProof({ call: async () => answer }, expected.thread_id)).rejects.toThrow();
  }
});
