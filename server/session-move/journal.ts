import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionMoveRecord } from "../../shared/session-move.ts";
import { withOwnerGuard } from "../owner-guard.ts";
import { writePrivateState } from "../private-state.ts";
import { inside, MoveRefused, readMoveFile } from "./files.ts";

const PHASES = new Set(["preview", "quiescing", "snapshotting", "snapshotted", "restoring", "restored", "launching", "verifying", "binding", "complete", "cancelled"]);
const terminal = (record: SessionMoveRecord): boolean => record.phase === "complete" || record.phase === "cancelled";
const key = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length < 1024;

/** New private document, version 1. Unknown/corrupt versions are preserved and refuse all writes. */
export class MoveJournal {
  private readonly path: string;
  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.path = inside(stateDir, "session-moves.json", true);
  }
  list(): SessionMoveRecord[] {
    if (!existsSync(this.path)) return [];
    let bytes: Buffer;
    try { bytes = readMoveFile(dirname(this.path), "session-moves.json", 4 * 1024 * 1024).data; }
    catch { throw new MoveRefused("invalid_move_journal", "Move journal cannot be safely read; its bytes were preserved"); }
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { throw new MoveRefused("invalid_move_journal", "Move journal cannot be read; its bytes were preserved"); }
    if (value?.version !== 1 || !Array.isArray(value.moves) || value.moves.some((item: SessionMoveRecord) => !validRecord(item))
      || new Set(value.moves.map((item: SessionMoveRecord) => item.id)).size !== value.moves.length) throw new MoveRefused("invalid_move_journal", "Move journal format is unsupported; its bytes were preserved");
    return value.moves;
  }
  get(id: string): SessionMoveRecord {
    const item = this.list().find((record) => record.id === id);
    if (!item) throw new MoveRefused("move_not_found", "Move was not found");
    return item;
  }
  save(record: SessionMoveRecord): void {
    if (!validRecord(record)) throw new MoveRefused("invalid_move_journal", "Invalid move record");
    withOwnerGuard(this.path, () => {
      const all = this.list();
      const competing = all.find((item) => item.id !== record.id && !terminal(item) && item.plan.request.session_id === record.plan.request.session_id);
      if (!terminal(record) && competing) throw new MoveRefused("move_in_progress", "This logical session already has a move in progress");
      const index = all.findIndex((item) => item.id === record.id);
      if (index < 0) all.push(record); else all[index] = record;
      const document = { version: 1, moves: all };
      if (Buffer.byteLength(JSON.stringify(document, null, 2)) + 1 > 4 * 1024 * 1024) throw new MoveRefused("move_journal_full", "Move journal is full; its previous records were preserved");
      writePrivateState(this.path, document);
    });
  }
}

function validRecord(item: SessionMoveRecord): boolean {
  const plan = item?.plan, request = plan?.request;
  const needsSnapshot = ["snapshotted", "restoring", "restored", "launching", "verifying", "binding", "complete"].includes(item?.phase);
  const needsDestination = ["binding", "complete"].includes(item?.phase);
  return !!item && (!needsSnapshot || item.snapshot !== null) && (!needsDestination || item.destination !== null) && key(item.id) && PHASES.has(item.phase) && !!plan && !!request
    && key(request.session_id) && key(request.source_execution_id) && key(request.destination_machine_id) && key(request.destination_checkout)
    && Array.isArray(request.untracked_files) && request.untracked_files.every(key)
    && key(plan.source_machine_id) && key(plan.native_thread_id) && key(plan.source_checkout) && key(plan.fingerprint)
    && Array.isArray(plan.files) && plan.files.every((file) => key(file?.path) && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && ["tracked", "untracked", "codex"].includes(file.kind))
    && Array.isArray(plan.exclusions) && plan.exclusions.every(key)
    && (item.snapshot === null || (key(item.snapshot?.id) && key(item.snapshot.sha256)))
    && (item.destination === null || [item.destination?.machine_id, item.destination?.herdr_lifetime, item.destination?.pane_id, item.destination?.native_session_id, item.destination?.checkout, item.destination?.history_sha256].every(key))
    && (item.error === null || key(item.error));
}
