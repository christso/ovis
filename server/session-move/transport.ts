import type { Machine } from "../../shared/machines.ts";
import { readCapped } from "../remote-json.ts";
import { MoveRefused } from "./files.ts";

export const MOVE_NODE_PATH = "/api/session-moves/node";
export const MOVE_CHUNK_BYTES = 512 * 1024;
export type MoveNodeAction = "capabilities" | "source" | "destination" | "hold" | "release" | "snapshot" | "read-chunk" | "prepare" | "write-chunk" | "restore" | "launch" | "verify";
const ACTIONS = new Set<MoveNodeAction>(["capabilities", "source", "destination", "hold", "release", "snapshot", "read-chunk", "prepare", "write-chunk", "restore", "launch", "verify"]);
export interface MoveNodeRequest { operation_id: string; action: MoveNodeAction; payload: Record<string, unknown> }
interface Machines {
  list(): Pick<Machine, "id" | "kind" | "enabled" | "state">[];
  endpoint(id: string): { url: string; token: string } | undefined;
}

/** Existing configured bridge endpoints only. The browser can never supply a host, token or target URL. */
export class MoveTransport {
  constructor(private readonly machines: Machines, private readonly local: (request: MoveNodeRequest) => Promise<unknown>, private readonly fetcher: (url: string, options: RequestInit) => Promise<Response> = fetch) {}
  async call(machineId: string, request: MoveNodeRequest, signal?: AbortSignal): Promise<unknown> {
    if (!ACTIONS.has(request.action) || !/^[a-f0-9-]{36}$/.test(request.operation_id)) throw new MoveRefused("invalid_move_request", "Invalid transfer operation");
    const machine = this.machines.list().find((item) => item.id === machineId);
    if (!machine?.enabled || machine.state !== "connected") throw new MoveRefused("machine_unavailable", "The configured PC must be connected before continuing the move");
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > 1024 * 1024) throw new MoveRefused("move_request_too_large", "Transfer chunks exceed the supported request size");
    if (machine.kind === "local") return this.local(request);
    const endpoint = this.machines.endpoint(machineId);
    if (!endpoint) throw new MoveRefused("machine_unavailable", "The configured PC is disconnected");
    let response: Response;
    try {
      response = await this.fetcher(endpoint.url + MOVE_NODE_PATH, { method: "POST", headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" }, body,
        redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new MoveRefused(response.status === 404 ? "move_unsupported" : "move_remote_refused", "The configured PC did not accept this transfer step");
      }
      return JSON.parse(Buffer.from(await readCapped(response, 1024 * 1024)).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof MoveRefused) throw error;
      // Raw SSH/fetch errors and response bodies can contain bridge tokens or arbitrary output.
      throw new MoveRefused("move_transport_failed", "Transfer connection failed; reconcile the operation before retrying");
    }
  }
}
