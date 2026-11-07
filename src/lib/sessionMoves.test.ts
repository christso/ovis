import { moveRefusal } from "../components/SessionMoveDialog.tsx";
import { afterEach, expect, it } from "bun:test";
import type { SessionMoveRecord } from "../../shared/session-move.ts";
import { cancelSessionMove, fetchSessionMoves, previewSessionMove, runSessionMove, sessionMoveStateValue } from "./sessionMoves.ts";
import { nativeTransport, setTransport } from "./transport.ts";

afterEach(() => setTransport(nativeTransport));
const request = { session_id: "logical", source_execution_id: "execution", destination_machine_id: "target", destination_checkout: "/work/new", untracked_files: ["notes.txt"] };
const record: SessionMoveRecord = { id: "operation", phase: "preview", plan: { request, source_machine_id: "source", source_checkout: "/work/old", native_thread_id: "native", files: [{ path: "notes.txt", bytes: 12, kind: "untracked" }], exclusions: ["Ignored files"], fingerprint: "reviewed" }, snapshot: null, destination: null, error: null };
const state = { record, running: false };
it("accepts supported receipts and rejects malformed/future move state before enabling mutations", async () => {
  expect(sessionMoveStateValue(state)).toBe(true);
  for (const value of [{}, { ...state, running: "false" }, { ...state, record: { ...record, phase: "future" } }, { ...state, record: { ...record, phase: "complete" } }, { ...state, record: { ...record, phase: "verifying", snapshot: null } }, { ...state, record: { ...record, phase: "binding", snapshot: { id: "snapshot", sha256: "proof" }, destination: null } }, { ...state, record: { ...record, plan: { ...record.plan, files: [{ path: "notes.txt", bytes: -1, kind: "untracked" }] } } }]) {
    expect(sessionMoveStateValue(value)).toBe(false);
    setTransport({ ...nativeTransport, fetch: async () => Response.json({ moves: [value] }) });
    await expect(fetchSessionMoves()).rejects.toMatchObject({ code: "move_unreadable" });
  }
});
it("sends explicit operation actions with the mutation guard and reviewed fingerprint", async () => {
  const calls: { input: string; init?: RequestInit }[] = [];
  setTransport({ ...nativeTransport, fetch: async (input, init) => { calls.push({ input: String(input), init }); return Response.json(state); } });
  expect(await previewSessionMove(request, record.id)).toEqual(state);
  await runSessionMove(record.id, record.plan.fingerprint);
  await cancelSessionMove(record.id);
  expect(calls.map((item) => JSON.parse(String(item.init?.body)))).toEqual([{ action: "preview", request, id: record.id }, { action: "run", id: record.id, fingerprint: "reviewed" }, { action: "cancel", id: record.id }]);
  for (const call of calls) {
    expect(call.input).toBe("/api/session-moves");
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("x-herdr-machine")).toBe("1");
  }
});
it("never automatically retries a mutation whose response was lost", async () => {
  let calls = 0;
  setTransport({ ...nativeTransport, fetch: async () => { calls++; throw new Error("fixture disconnect"); } });
  await expect(runSessionMove(record.id, record.plan.fingerprint)).rejects.toThrow("fixture disconnect");
  expect(calls).toBe(1);
});

it("never advises reopening a source client when a destination launch may already exist", () => {
  const t = (key: string): string => key;
  for (const code of ["source_store_unknown", "source_unobserved", "source_observation_missing"]) {
    expect(moveRefusal(code, t, "preview")).toContain("source PC");
    expect(moveRefusal(code, t, "verifying")).toContain("Keep the existing transfer");
    expect(moveRefusal(code, t, "binding")).not.toContain("Open this session");
  }
  expect(moveRefusal("source_not_quiescent", t, "preview")).toContain("Finish the turn");
  expect(moveRefusal("source_not_quiescent", t, "launching")).toContain("destination launch may already exist");
});

it("explains supported-scope refusals without presenting them as retryable connection failures", () => {
  const t = (key: string): string => key;
  expect(moveRefusal("unsupported_checkout", t)).toContain("index flags");
  expect(moveRefusal("unsupported_runtime", t)).toContain("built-in OpenAI");
  expect(moveRefusal("unsupported_filesystem", t)).toContain("same filesystem");
  expect(moveRefusal("artifact_path_conflict", t)).toContain("same absolute checkout path");
  expect(moveRefusal("source_busy", t)).toContain("Finish the active");
  expect(moveRefusal("untracked_scope", t)).toContain("Select required");
});
