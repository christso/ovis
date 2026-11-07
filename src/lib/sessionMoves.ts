import type { SessionMovePhase, SessionMoveRecord, SessionMoveRequest } from "../../shared/session-move.ts";
import { apiFetch } from "./api-request-id.ts";
import { ApiError, errorFrom } from "./api.ts";

export interface SessionMoveState { record: SessionMoveRecord; running: boolean }
const PATH = "/api/session-moves";
const PHASES = new Set<SessionMovePhase>(["preview", "quiescing", "snapshotting", "snapshotted", "restoring", "restored", "launching", "verifying", "binding", "complete", "cancelled"]);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);

/** An unreadable receipt never enables a move or an automatic retry. */
export function sessionMoveStateValue(value: unknown): value is SessionMoveState {
  const state = object(value), record = object(state.record), plan = object(record.plan), request = object(plan.request);
  if (typeof state.running !== "boolean" || !text(record.id) || !PHASES.has(record.phase as SessionMovePhase)
    || !text(plan.fingerprint) || !text(plan.source_machine_id) || !text(plan.source_checkout) || !text(plan.native_thread_id)
    || ![request.session_id, request.source_execution_id, request.destination_machine_id, request.destination_checkout].every(text)
    || !strings(request.untracked_files) || !strings(plan.exclusions) || !Array.isArray(plan.files)
    || (plan.untracked_candidates !== undefined && !strings(plan.untracked_candidates))
    || !plan.files.every((raw) => { const file = object(raw); return text(file.path) && Number.isSafeInteger(file.bytes) && Number(file.bytes) >= 0 && ["tracked", "untracked", "codex"].includes(String(file.kind)); })
    || (record.error !== null && !text(record.error))) return false;
  const snapshot = object(record.snapshot), destination = object(record.destination);
  if (record.snapshot !== null && (!text(snapshot.id) || !text(snapshot.sha256))) return false;
  if (record.destination !== null && ![destination.machine_id, destination.herdr_lifetime, destination.pane_id, destination.native_session_id, destination.checkout, destination.history_sha256].every(text)) return false;
  if (["snapshotted", "restoring", "restored", "launching", "verifying", "binding", "complete"].includes(String(record.phase)) && record.snapshot === null) return false;
  return !["binding", "complete"].includes(String(record.phase)) || record.destination !== null;
}

const unreadable = () => new ApiError(PATH, 503, "The move status format cannot be read by this app. Update Ovis and reload.", "move_unreadable");
async function stateResponse(response: Response): Promise<SessionMoveState> {
  if (!response.ok) throw await errorFrom(PATH, response);
  const value: unknown = await response.json().catch(() => null);
  if (!sessionMoveStateValue(value)) throw unreadable();
  return value;
}
export async function fetchSessionMoves(signal?: AbortSignal): Promise<SessionMoveState[]> {
  const response = await apiFetch(PATH, { signal });
  if (!response.ok) throw await errorFrom(PATH, response);
  const value = object(await response.json().catch(() => null));
  if (!Array.isArray(value.moves) || !value.moves.every(sessionMoveStateValue)) throw unreadable();
  return value.moves;
}
async function changeMove(body: object): Promise<SessionMoveState> {
  return stateResponse(await apiFetch(PATH, { method: "POST", headers: { "content-type": "application/json", "x-herdr-machine": "1" }, body: JSON.stringify(body) }));
}
export const previewSessionMove = (request: SessionMoveRequest, id?: string): Promise<SessionMoveState> => changeMove({ action: "preview", request, ...(id ? { id } : {}) });
export const runSessionMove = (id: string, fingerprint: string): Promise<SessionMoveState> => changeMove({ action: "run", id, fingerprint });
export const cancelSessionMove = (id: string): Promise<SessionMoveState> => changeMove({ action: "cancel", id });
