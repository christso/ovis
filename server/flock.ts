import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FlockCommand, FlockRegistry } from "../shared/flock.ts";
import { flockCommandValue, flockRegistryValue } from "../shared/flock-schema.ts";
import type { Machine } from "../shared/machines.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { flockBinding, flockCheckout, sameFlockBinding } from "../shared/flock-inventory.ts";
import { isJsonObject, jsonResponse } from "./http.ts";
import { readStateDocument, writeStateDocument } from "./state-document.ts";
import { sameOrigin } from "./machine-security.ts";
import { flockObservationValue, flockReceiptKey } from "../shared/flock-relationships.ts";

export class FlockError extends Error {
  constructor(readonly code: "flock_conflict" | "flock_unreadable" | "invalid_flock", message: string) { super(message); }
}
export class FlockStore {
  private readonly path: string;
  constructor(stateDir: string) { this.path = join(stateDir, "flock.json"); }
  read(): FlockRegistry {
    const saved = readStateDocument(this.path);
    if (saved.kind === "missing") return { version: 1, revision: 0, works: [], sessions: [], checkouts: [], executions: [] };
    if (saved.kind !== "json" || !flockRegistryValue(saved.value)) throw new FlockError("flock_unreadable", "The work registry format cannot be read. Its saved data has been preserved.");
    return saved.value;
  }
  /** Import bridge-owned receipts only; polling an existing event never changes the revision. */
  observe(sources: readonly Machine[]): FlockRegistry {
    const next = this.read();
    const seen = new Set((next.observations ?? []).map(flockReceiptKey));
    let changed = false;
    for (const machine of sources) {
      if (machine.state !== "connected" || !machine.snapshot?.herdr_lifetime) continue;
      for (const event of machine.snapshot.flock_observations ?? []) {
        if (!flockObservationValue(event) || !machine.snapshot.flock_bindings?.some((binding) => binding.agent === "codex" && binding.native_session_id.toLowerCase() === event.source_native_session_id.toLowerCase())) continue;
        const stored = { id: event.id, kind: event.kind, source_native_session_id: event.source_native_session_id,
          target_native_session_id: event.target_native_session_id, occurred_at: event.occurred_at, source: event.source, machine_id: machine.id };
        const key = flockReceiptKey(stored);
        if (seen.has(key)) continue;
        (next.observations ??= []).push(stored); seen.add(key); changed = true;
      }
    }
    if (changed) {
      next.revision += 1;
      if (!flockRegistryValue(next)) throw new FlockError("invalid_flock", "Observed coordination metadata cannot be saved");
      writeStateDocument(this.path, `${JSON.stringify(next, null, 2)}\n`, false);
    }
    return next;
  }
  /** Reads on every change so another browser or a replaced on-disk format cannot be overwritten. */
  change(revision: number, command: FlockCommand, machines: readonly Machine[]): FlockRegistry {
    if (!flockCommandValue(command)) throw new FlockError("invalid_flock", "Invalid work registry change");
    const next = this.read();
    if (revision !== next.revision) throw new FlockError("flock_conflict", "The work registry changed. Refresh and try again.");
    const work = (id: string | null): void => { if (id !== null && !next.works.some((item) => item.id === id)) throw new FlockError("invalid_flock", "Work no longer exists"); };
    if (command.type === "create-work") next.works.push({ id: randomUUID(), name: command.name });
    else if (command.type === "rename-work") {
      const item = next.works.find((item) => item.id === command.id);
      if (!item) throw new FlockError("invalid_flock", "Work no longer exists");
      item.name = command.name;
    } else if (command.type === "rename-session") {
      work(command.work_id);
      const item = next.sessions.find((item) => item.id === command.id);
      if (!item) throw new FlockError("invalid_flock", "Session no longer exists");
      item.name = command.name; item.work_id = command.work_id;
    } else {
      const machine = machines.find((item) => item.id === command.binding.machine_id);
      const pane = machine?.snapshot?.panes.find((item) => item.pane_id === command.binding.pane_id);
      const current = pane && machine ? flockBinding(machine, pane) : null;
      if (!machine || machine.state !== "connected" || !pane || !current || !sameFlockBinding(current, command.binding)) throw new FlockError("flock_conflict", "The execution changed or its source is unavailable. Refresh and try again.");
      if (next.executions.some((item) => sameFlockBinding(item, current))) throw new FlockError("flock_conflict", "This execution already belongs to a logical session");
      let session = command.session_id ? next.sessions.find((item) => item.id === command.session_id) : undefined;
      if (command.session_id && !session) throw new FlockError("invalid_flock", "Session no longer exists");
      if (command.expected_execution_id !== undefined && session?.current_execution_id !== command.expected_execution_id) throw new FlockError("flock_conflict", "The session's current execution changed. Refresh and try again.");
      if (!session) {
        work(command.work_id ?? null);
        session = { id: randomUUID(), name: command.name!, work_id: command.work_id ?? null, current_execution_id: null };
        next.sessions.push(session);
      }
      const checkout = flockCheckout(machine, pane);
      const checkoutId = checkout ? randomUUID() : null;
      if (checkout && checkoutId) next.checkouts.push({ ...checkout, id: checkoutId });
      const id = randomUUID();
      next.executions.push({ ...current, id, session_id: session.id, checkout_id: checkoutId, created_at: new Date().toISOString() });
      session.current_execution_id = id;
    }
    next.revision += 1;
    if (!flockRegistryValue(next)) throw new FlockError("invalid_flock", "The source metadata cannot be saved in the work registry");
    writeStateDocument(this.path, `${JSON.stringify(next, null, 2)}\n`, false);
    return next;
  }
}

/** Manager-only document: never forwarded through the per-machine API. */
export async function handleFlockRequest(request: Request, store: FlockStore, machines: readonly Machine[], readSource?: (id: string) => Promise<readonly Machine[]>, presentSnapshot: (snapshot: SessionSnapshot) => SessionSnapshot = (snapshot) => snapshot): Promise<Response> {
  const reply = (body: unknown, status = 200) => jsonResponse(body, status, { "cache-control": "no-store" });
  try {
    if (request.method === "GET") {
      const registry = store.read();
      if (new URL(request.url).searchParams.get("sources") !== "1") return reply(registry);
      const sources = await Promise.all(machines.map(async (machine) => {
        try {
          if (readSource && machine.state === "connected") {
            const source = (await readSource(machine.id))[0];
            if (source) return source;
          }
        }
        catch { /* unavailable proof cannot authorize an inventory row */ }
        return { ...machine, snapshot: machine.snapshot ? { ...machine.snapshot, flock_bindings: readSource ? [] : machine.snapshot.flock_bindings } : null };
      }));
      return reply({ ...store.observe(sources), sources: sources.map((source) => ({ ...source, snapshot: source.snapshot ? presentSnapshot(source.snapshot) : null })) });
    }
    if (request.method !== "POST") return reply({ error: { code: "method_not_allowed", message: "Use GET or POST /api/flock" } }, 405);
    if (!sameOrigin(request) || request.headers.get("x-herdr-machine") !== "1") return reply({ error: { code: "invalid_origin", message: "Use controls from this app" } }, 403);
    const body = await request.text();
    if (Buffer.byteLength(body) > 16384) return reply({ error: { code: "too_large", message: "Work registry change is too large" } }, 413);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return reply({ error: { code: "invalid_json", message: "The body is not JSON" } }, 400); }
    if (!isJsonObject(raw) || !Number.isSafeInteger(raw["revision"]) || !flockCommandValue(raw["command"])) return reply({ error: { code: "invalid_flock", message: "Send a registry revision and command" } }, 400);
    const command = raw["command"];
    const sources = command.type === "adopt" && readSource ? await readSource(command.binding.machine_id) : machines;
    return reply(store.change(raw["revision"] as number, command, sources));
  } catch (error) {
    if (error instanceof FlockError) return reply({ error: { code: error.code, message: error.message } }, error.code === "flock_conflict" ? 409 : error.code === "flock_unreadable" ? 503 : 400);
    throw error;
  }
}
