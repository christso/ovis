import { randomUUID } from "node:crypto";
import type { SessionMoveDestination, SessionMovePlan, SessionMoveRecord, SessionMoveRequest, SessionMoveSnapshot } from "../../shared/session-move.ts";
import { MoveRefused } from "./files.ts";
import { MoveJournal } from "./journal.ts";
import type { QuiescentSource } from "./quiescence.ts";

/** Machine adapters use configured transports and operation-owned durable receipts, never browser-supplied shell commands. */
export interface MovePorts {
  preview(request: SessionMoveRequest, operationId: string): Promise<SessionMovePlan>;
  /** Revalidate source execution AND destination availability/conflicts before touching source. */
  preflight(plan: SessionMovePlan): Promise<void>;
  quiesce(plan: SessionMovePlan): Promise<QuiescentSource>;
  /** Complete durable snapshot or return an existing operation receipt; never remove source data. */
  snapshot(id: string, plan: SessionMovePlan, lease: QuiescentSource): Promise<SessionMoveSnapshot>;
  restore(id: string, plan: SessionMovePlan, snapshot: SessionMoveSnapshot): Promise<void>;
  /** Start at most one owned pane for this operation. Ambiguous transport failures must be reconciled. */
  launch(id: string, plan: SessionMovePlan, snapshot: SessionMoveSnapshot): Promise<void>;
  inspect(id: string, plan: SessionMovePlan, snapshot: SessionMoveSnapshot): Promise<
    { state: "absent" } | { state: "pending" | "unknown" } | { state: "resumed"; destination: SessionMoveDestination }>;
  /** Atomically adopt with expected source execution; if already applied, compare the exact destination binding. */
  bind(id: string, plan: SessionMovePlan, destination: SessionMoveDestination): Promise<void>;
}

/** Durable intent precedes every external side effect. A retry never blindly repeats native launch. */
export class SessionMoves {
  private running = new Set<string>();
  constructor(private readonly journal: MoveJournal, private readonly ports: MovePorts) {}
  async preview(request: SessionMoveRequest, existingId?: string): Promise<SessionMoveRecord> {
    const id = existingId ?? randomUUID();
    if (existingId) {
      const prior = this.journal.get(id);
      if (this.running.has(id) || prior.snapshot || !["preview", "quiescing", "snapshotting"].includes(prior.phase) || prior.plan.request.session_id !== request.session_id || prior.plan.request.source_execution_id !== request.source_execution_id) throw new MoveRefused("move_busy", "This move can no longer change its preview");
    }
    const plan = await this.ports.preview(request, id);
    const record: SessionMoveRecord = { id, phase: "preview", plan, snapshot: null, destination: null, error: null };
    this.journal.save(record);
    return record;
  }
  list(): SessionMoveRecord[] { return this.journal.list(); }
  isRunning(id: string): boolean { return this.running.has(id); }
  cancel(id: string): SessionMoveRecord {
    if (this.running.has(id)) throw new MoveRefused("move_busy", "Wait for this move step to finish before cancelling");
    const record = this.journal.get(id);
    if (["launching", "verifying", "binding", "complete"].includes(record.phase)) throw new MoveRefused("reconciliation_required", "Reconcile destination execution before cancelling this move");
    record.phase = "cancelled"; record.error = null; this.journal.save(record); return record;
  }
  async run(id: string, fingerprint: string): Promise<SessionMoveRecord> {
    if (this.running.has(id)) throw new MoveRefused("move_busy", "This move is already running");
    this.running.add(id);
    let lease: QuiescentSource | undefined;
    let record: SessionMoveRecord | undefined;
    const save = (phase: SessionMoveRecord["phase"]): void => { record!.phase = phase; record!.error = null; this.journal.save(record!); };
    try {
      record = this.journal.get(id);
      if (fingerprint !== record.plan.fingerprint) throw new MoveRefused("preview_changed", "Review the current transfer preview before continuing");
      if (["complete", "cancelled"].includes(record.phase)) return record;
      if (record.phase === "binding" && record.destination) {
        await this.ports.bind(id, record.plan, record.destination); save("complete"); return record;
      }
      await this.ports.preflight(record.plan);
      if (record.phase === "preview") save("quiescing");
      lease = await this.ports.quiesce(record.plan);
      if (lease.thread_id !== record.plan.native_thread_id) throw new MoveRefused("thread_mismatch", "Source ownership belongs to a different thread");
      await lease.assertHeld();
      if (!record.snapshot) {
        save("snapshotting");
        record.snapshot = await this.ports.snapshot(id, record.plan, lease);
        await lease.assertHeld(); save("snapshotted");
      }
      if (["quiescing", "snapshotting", "snapshotted", "restoring"].includes(record.phase)) {
        save("restoring");
        await this.ports.restore(id, record.plan, record.snapshot);
        await lease.assertHeld(); save("restored");
      }
      if (record.phase === "restored") {
        save("launching");
        await lease.assertHeld();
        await this.ports.launch(id, record.plan, record.snapshot);
        save("verifying");
      }
      await lease.assertHeld();
      const seen = await this.ports.inspect(id, record.plan, record.snapshot);
      if (seen.state !== "resumed") {
        // Even an absent result is not an automatic relaunch: absence must be a durable
        // destination-side receipt, and a new deliberate attempt can consume it there.
        throw new MoveRefused("reconciliation_required", "Destination resume is not verified; source data was retained");
      }
      const destination = seen.destination;
      if (destination.native_session_id !== record.plan.native_thread_id || destination.machine_id !== record.plan.request.destination_machine_id
        || destination.checkout !== record.plan.request.destination_checkout || destination.history_sha256 !== record.snapshot.sha256
        || !destination.herdr_lifetime || !destination.pane_id) throw new MoveRefused("resume_mismatch", "Destination did not verify the requested native session and history");
      await lease.assertHeld(); record.destination = destination; save("binding");
      await this.ports.bind(id, record.plan, destination);
      save("complete");
      return record;
    } catch (error) {
      if (record && !["complete", "cancelled"].includes(record.phase)) {
        record.error = error instanceof MoveRefused ? error.code : "move_failed";
        this.journal.save(record);
      }
      throw error;
    } finally { await lease?.release(); this.running.delete(id); }
  }
}
