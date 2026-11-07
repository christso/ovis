import type { SessionMoveRequest } from "../../shared/session-move.ts";
import { jsonResponse, setRequestRoute } from "../http.ts";
import { sameOrigin } from "../machine-security.ts";
import { readCapped } from "../remote-json.ts";
import type { MoveCoordinator } from "./coordinator.ts";
import { MoveRefused, movePath } from "./files.ts";
import type { MoveNode } from "./node.ts";
import { operationId } from "./spool.ts";
import type { MoveNodeRequest } from "./transport.ts";

export const MOVE_PATH = "/api/session-moves";
const reply = (body: unknown, status = 200) => jsonResponse(body, status, { "cache-control": "no-store" });
const fail = (code: string, message: string, status = 409) => reply({ error: { code, message } }, status);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
async function body(request: Request): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(Buffer.from(await readCapped(new Response(request.body, { headers: request.headers }), 1024 * 1024)).toString())); }
  catch { throw new MoveRefused("invalid_move_request", "Send a bounded JSON transfer request"); }
}
export async function handleMoveNode(request: Request, node: MoveNode, authorized: boolean): Promise<Response> {
  if (!authorized) return fail("move_node_forbidden", "Transfer node operations require the configured bridge credential", 403);
  if (request.method !== "POST" || !sameOrigin(request)) return fail("invalid_move_request", "Use transfer node controls from the configured server", 403);
  try {
    const value = await body(request); operationId(value.operation_id);
    if (typeof value.action !== "string" || !value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) throw new MoveRefused("invalid_move_request", "Invalid transfer node request");
    return reply(await node.call(value as unknown as MoveNodeRequest));
  } catch (error) { return moveError(error); }
}
export async function handleSessionMoves(request: Request, coordinator: MoveCoordinator | null): Promise<Response> {
  setRequestRoute(MOVE_PATH);
  if (!coordinator) return fail("move_unsupported", "This bridge does not coordinate logical session moves", 404);
  if (!sameOrigin(request)) return fail("invalid_origin", "Use session move controls from this app", 403);
  const state = (record: ReturnType<typeof coordinator.moves.list>[number]) => ({ record, running: coordinator.moves.isRunning(record.id) });
  if (request.method === "GET") return reply({ moves: coordinator.moves.list().map(state) });
  if (request.method !== "POST" || !sameOrigin(request) || request.headers.get("x-herdr-machine") !== "1") return fail("invalid_move_request", "Use session move controls from this app", 403);
  try {
    const value = await body(request);
    if (value.action === "preview") {
      const raw = object(value.request);
      if (![raw.session_id, raw.source_execution_id, raw.destination_machine_id, raw.destination_checkout].every((field) => typeof field === "string" && field.length > 0 && field.length < 1024)
        || !Array.isArray(raw.untracked_files) || raw.untracked_files.length > 20_000 || raw.untracked_files.some((file) => typeof file !== "string" || file.length > 1023)) throw new MoveRefused("invalid_move_request", "Choose a logical session, configured destination and explicit file scope");
      raw.untracked_files.forEach((file) => movePath(file as string));
      const record = await coordinator.moves.preview(raw as unknown as SessionMoveRequest, value.id === undefined ? undefined : operationId(value.id));
      return reply(state(record));
    }
    const id = operationId(value.id), current = coordinator.moves.list().find((record) => record.id === id);
    if (!current) throw new MoveRefused("move_not_found", "Move operation was not found");
    if (value.action === "cancel") return reply(state(await coordinator.cancel(id)));
    if (value.action !== "run" || value.fingerprint !== current.plan.fingerprint) throw new MoveRefused("preview_changed", "Review the current transfer preview before continuing");
    if (!coordinator.moves.isRunning(id)) void coordinator.moves.run(id, current.plan.fingerprint).catch(() => {});
    return reply(state(coordinator.moves.list().find((record) => record.id === id)!), 202);
  } catch (error) { return moveError(error); }
}
function moveError(error: unknown): Response {
  if (error instanceof MoveRefused) return fail(error.code, error.message);
  return fail("move_failed", "Transfer step failed; its source data and recovery receipt were retained", 503);
}
