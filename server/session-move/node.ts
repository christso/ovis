import { existsSync, statSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import type { SessionMoveDestination } from "../../shared/session-move.ts";
import { writePrivateState } from "../private-state.ts";
import { restoreCheckout, snapshotCheckout, type CheckoutSnapshot } from "./checkout.ts";
import { restoreCodexHistory, snapshotCodex, type CodexSnapshot, type CodexMoveRuntime } from "./codex.ts";
import { digest, inside, MoveRefused, readMoveFile, writeMoveFile, type MoveFile } from "./files.ts";
import { MoveSpool, operationId } from "./spool.ts";
import { holdQuiescentCodex, type QuiescentSource } from "./quiescence.ts";
import { MOVE_CHUNK_BYTES, type MoveNodeRequest } from "./transport.ts";
import { nativeHistoryProof, verifyNativeResume, type NativeMoveRpc } from "./verify.ts";

export interface SourceObservation { home: string; rollout: string; cwd: string; thread_id: string; lifetime: string; pane_id: string }
export interface NodeNative extends NativeMoveRpc { close(): Promise<void> }
export interface MoveNodeRuntime {
  capabilities(): Promise<CodexMoveRuntime & { home: string }>;
  observe(paneId: string, threadId: string, lifetime: string): Promise<SourceObservation>;
  native(home: string, proxy: boolean): Promise<NodeNative>;
  create(cwd: string, home: string, label: string): Promise<{ pane_id: string; lifetime: string }>;
  find(label: string, cwd: string): Promise<{ pane_id: string; lifetime: string } | null>;
  start(paneId: string, threadId: string): Promise<void>;
  paneSession(paneId: string, threadId: string, lifetime: string): Promise<boolean>;
}
export interface TransferBundle {
  version: 1; checkout: CheckoutSnapshot; codex: CodexSnapshot; history: string; fingerprint: string;
  files: MoveFile[]; untracked_candidates: string[];
}
interface NodeReceipt {
  version: 1; source?: SourceObservation; source_dir?: string; bundle?: TransferBundle;
  destination?: { checkout: string; home: string; bundle: TransferBundle; phase: "prepared" | "restored" | "creating" | "starting" | "started"; pane_id?: string; lifetime?: string };
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => { if (typeof value !== "string" || !value || value.length > 4096 || /[\0\r\n]/.test(value)) throw new MoveRefused("invalid_move_request", "Invalid transfer argument"); return value; };

/** Per-machine operation receipts contain observations/transfer data, never logical names or a second session registry. */
export class MoveNode {
  private held = new Map<string, QuiescentSource>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly stateDir: string, private readonly runtime: MoveNodeRuntime) { mkdirSync(stateDir, { recursive: true, mode: 0o700 }); }
  close(): void { for (const lease of this.held.values()) lease.release(); this.held.clear(); }
  async call(request: MoveNodeRequest): Promise<unknown> {
    const id = operationId(request.operation_id), previous = this.pending.get(id) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(() => this.step(id, request.action, record(request.payload)));
    this.pending.set(id, work);
    try { return await work; } finally { if (this.pending.get(id) === work) this.pending.delete(id); }
  }
  private root(id: string): string { const path = inside(realpathSync(this.stateDir), `move-nodes/${id}`, true); mkdirSync(path, { recursive: true, mode: 0o700 }); return path; }
  private read(id: string): NodeReceipt {
    const root = this.root(id);
    if (!existsSync(join(root, "node.json"))) return { version: 1 };
    let receipt: NodeReceipt;
    try { receipt = JSON.parse(readMoveFile(root, "node.json", 4 * 1024 * 1024).data.toString()); }
    catch { throw new MoveRefused("invalid_node_receipt", "Transfer receipt cannot be read; its data was preserved"); }
    if (receipt?.version !== 1) throw new MoveRefused("invalid_node_receipt", "Transfer receipt version is unsupported");
    return receipt;
  }
  private save(id: string, receipt: NodeReceipt): void {
    if (Buffer.byteLength(JSON.stringify(receipt, null, 2)) > 4 * 1024 * 1024) throw new MoveRefused("snapshot_too_large", "Transfer receipt exceeds the supported size");
    writePrivateState(inside(this.root(id), "node.json", true), receipt);
  }
  private async capture(id: string, source: SourceObservation, selected: string[]): Promise<{ bundle: TransferBundle; dir: string }> {
    auxiliary(source.home, source.thread_id);
    const dir = inside(this.root(id), `snapshot-${randomUUID()}`, true); mkdirSync(dir, { mode: 0o700 });
    const checkout = snapshotCheckout(source.cwd, dir, selected), codex = snapshotCodex(source.home, source.rollout, source.thread_id, dir);
    if (codex.cwd !== source.cwd) throw new MoveRefused("source_changed", "The source checkout changed");
    for (const artifact of codex.checkout_artifacts) {
      const tracked = Bun.spawnSync(["git", "ls-files", "--error-unmatch", "--", artifact], { cwd: source.cwd, stdout: "ignore", stderr: "ignore" }).exitCode === 0;
      if (!tracked && !selected.includes(artifact)) throw new MoveRefused("untracked_scope", "Select the referenced image file before moving this session");
    }
    const native = await this.runtime.native(source.home, true);
    let history: string;
    try { history = await nativeHistoryProof(native, source.thread_id); } finally { await native.close(); }
    const latest = readMoveFile(source.home, source.rollout).file;
    const captured = codex.files.find((file) => file.path === source.rollout.replace(/^archived_sessions\//, "sessions/"));
    if (!captured || captured.sha256 !== latest.sha256) throw new MoveRefused("source_changed", "Source history changed while preparing the preview");
    const files = [checkout.bundle, checkout.staged, checkout.unstaged, ...checkout.untracked.map((file) => ({ ...file, path: `untracked/${file.path}` })), ...codex.files.map((file) => ({ ...file, path: `codex/${file.path}` })), ...(codex.history_index ? [codex.history_index] : [])];
    const fingerprint = digest(Buffer.from(JSON.stringify({ head: checkout.head, staged: checkout.staged.sha256, unstaged: checkout.unstaged.sha256, untracked: checkout.untracked, history, root: codex.root, artifacts: codex.checkout_artifacts })));
    return { dir, bundle: { version: 1, checkout, codex, history, fingerprint, files, untracked_candidates: [...checkout.excluded_untracked, ...selected].sort() } };
  }
  private async step(id: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
    const receipt = this.read(id);
    if (action === "capabilities") { const { home: _home, ...capabilities } = await this.runtime.capabilities(); return { protocol: 1, ...capabilities }; }
    if (action === "source") {
      const pane = text(payload.pane_id), thread = text(payload.thread_id), lifetime = text(payload.lifetime);
      const selected = payload.untracked_files;
      if (!Array.isArray(selected) || !selected.every((item) => typeof item === "string")) throw new MoveRefused("invalid_move_request", "Choose individual untracked files");
      if (!receipt.source) { receipt.source = await this.runtime.observe(pane, thread, lifetime); this.save(id, receipt); }
      if (receipt.source.pane_id !== pane || receipt.source.thread_id !== thread || receipt.source.lifetime !== lifetime) throw new MoveRefused("source_changed", "The source observation belongs to another execution");
      const captured = await this.capture(id, receipt.source, selected);
      receipt.bundle = captured.bundle; receipt.source_dir = captured.dir; this.save(id, receipt);
      return captured.bundle;
    }
    if (action === "destination") {
      const capabilities = await this.runtime.capabilities();
      const checkout = destinationPath(text(payload.checkout));
      if (statSync(dirname(checkout)).dev !== statSync(this.stateDir).dev) throw new MoveRefused("unsupported_filesystem", "Destination checkout must use the transfer staging filesystem");
      if (existsSync(checkout) && receipt.destination?.checkout !== checkout) throw new MoveRefused("destination_conflict", "Destination checkout already exists");
      const source = payload.bundle as TransferBundle;
      bundleValue(source);
      if (source.codex.checkout_artifacts.length && source.codex.cwd !== checkout) throw new MoveRefused("artifact_path_conflict", "Image-bearing sessions require the same absolute checkout path");
      for (const file of source.codex.files) if (existsSync(inside(capabilities.home, file.path, true)) && !receipt.destination) throw new MoveRefused("destination_conflict", "Destination already has a referenced native session file");
      // A duplicate native UUID can live under a different filename or database path.
      if (!receipt.destination) nativeThreadConflict(capabilities.home, source.codex.thread_id);
      return { protocol: 1, ...capabilities, home: undefined };
    }
    if (action === "hold") {
      if (!receipt.source || !receipt.bundle) throw new MoveRefused("source_unobserved", "Preview the source before exiting its native client");
      let lease = this.held.get(id);
      if (!lease) { lease = holdQuiescentCodex(receipt.source.home, receipt.source.thread_id); this.held.set(id, lease); }
      lease.assertHeld();
      if (payload.capture === true) {
        const selected = receipt.bundle.checkout.untracked.map((file) => file.path);
        const captured = await this.capture(id, receipt.source, selected);
        if (captured.bundle.fingerprint !== receipt.bundle.fingerprint) throw new MoveRefused("source_changed", "Source work or conversation changed; refresh the preview");
        receipt.bundle = captured.bundle; receipt.source_dir = captured.dir; this.save(id, receipt);
      }
      return { held: true };
    }
    if (action === "release") { this.held.get(id)?.release(); this.held.delete(id); return { released: true }; }
    if (action === "snapshot") {
      this.held.get(id)?.assertHeld();
      if (!this.held.has(id) || !receipt.bundle) throw new MoveRefused("source_lease_lost", "Source ownership must be re-established");
      return receipt.bundle;
    }
    if (action === "read-chunk") {
      if (!receipt.bundle || !receipt.source_dir || !this.held.has(id)) throw new MoveRefused("source_lease_lost", "Source snapshot ownership is unavailable");
      const index = payload.index as number, offset = payload.offset as number;
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || offset < 0) throw new MoveRefused("invalid_chunk", "Invalid transfer chunk");
      const file = receipt.bundle.files[index]; if (!file || offset > file.bytes) throw new MoveRefused("invalid_chunk", "Invalid transfer file offset");
      const data = readMoveFile(receipt.source_dir, file.path).data;
      if (digest(data) !== file.sha256) throw new MoveRefused("corrupt_transfer", "Source snapshot changed");
      return { data: data.subarray(offset, offset + MOVE_CHUNK_BYTES).toString("base64") };
    }
    if (action === "prepare") {
      const bundle = payload.bundle as TransferBundle; bundleValue(bundle);
      const checkout = destinationPath(text(payload.checkout)), capabilities = await this.runtime.capabilities();
      if (receipt.destination && (receipt.destination.checkout !== checkout || receipt.destination.bundle.fingerprint !== bundle.fingerprint)) throw new MoveRefused("destination_conflict", "This operation already owns another destination");
      if (!receipt.destination) { receipt.destination = { checkout, home: capabilities.home, bundle, phase: "prepared" }; this.save(id, receipt); }
      const spool = new MoveSpool(this.stateDir, id); spool.offer({ version: 1, files: bundle.files });
      return { offsets: bundle.files.map((_, index) => spool.offset(index)) };
    }
    if (action === "write-chunk") {
      if (!receipt.destination) throw new MoveRefused("destination_unprepared", "Prepare this destination first");
      if (typeof payload.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data) || payload.data.length > 4 * Math.ceil(MOVE_CHUNK_BYTES / 3)) throw new MoveRefused("invalid_chunk", "Invalid transfer encoding");
      return { offset: new MoveSpool(this.stateDir, id).put(payload.index as number, payload.offset as number, Buffer.from(payload.data, "base64")) };
    }
    const destination = receipt.destination;
    if (!destination) throw new MoveRefused("destination_unprepared", "This move has no prepared destination");
    if (action === "restore") {
      if (destination.phase !== "prepared") return { restored: true };
      const staging = inside(this.root(id), "received", true); new MoveSpool(this.stateDir, id).materialize(staging);
      const temporaryCheckout = inside(this.root(id), "checkout", true);
      if (!existsSync(temporaryCheckout)) restoreCheckout(destination.bundle.checkout, staging, temporaryCheckout);
      // Every published path was preflighted; an interrupted publication is reconciled by byte equality.
      for (const file of destination.bundle.codex.files) {
        const target = inside(destination.home, file.path, true);
        if (existsSync(target)) {
          if (readMoveFile(destination.home, file.path).file.sha256 !== file.sha256) throw new MoveRefused("destination_conflict", "A native session publication conflicts with another file");
        } else writeMoveFile(destination.home, file, readMoveFile(staging, `codex/${file.path}`).data);
      }
      const native = await this.runtime.native(destination.home, false);
      try {
        // Initialize destination schema. Current-root cache rebuild is native, inherited rows are scoped imports.
        await native.call("thread/turns/list", { threadId: destination.bundle.codex.thread_id, limit: 1 });
        if (!existsSync(join(this.root(id), "index-imported.json"))) { restoreCodexHistory(destination.bundle.codex, staging, destination.home); writePrivateState(join(this.root(id), "index-imported.json"), { version: 1 }); }
      } finally { await native.close(); }
      publishCheckout(temporaryCheckout, destination.checkout, id);
      destination.phase = "restored"; this.save(id, receipt); return { restored: true };
    }
    const label = `ovis-move-${id}`;
    if (action === "launch") {
      if (["starting", "started"].includes(destination.phase)) return { launched: true };
      if (destination.phase !== "restored" && destination.phase !== "creating") throw new MoveRefused("destination_unrestored", "Restore this destination before launching");
      const recovering = destination.phase === "creating";
      destination.phase = "creating"; this.save(id, receipt);
      const existing = await this.runtime.find(label, destination.checkout);
      if (recovering && !existing) throw new MoveRefused("reconciliation_required", "Destination creation is uncertain; no second workspace was created");
      const opened = existing ?? await this.runtime.create(destination.checkout, destination.home, label);
      destination.pane_id = opened.pane_id; destination.lifetime = opened.lifetime; destination.phase = "starting"; this.save(id, receipt);
      await this.runtime.start(opened.pane_id, destination.bundle.codex.thread_id);
      destination.phase = "started"; this.save(id, receipt); return { launched: true };
    }
    if (action === "verify") {
      if (!destination.pane_id || !destination.lifetime) return { state: "unknown" };
      if (!await this.runtime.paneSession(destination.pane_id, destination.bundle.codex.thread_id, destination.lifetime)) return { state: "pending" };
      const native = await this.runtime.native(destination.home, true);
      try { await verifyNativeResume(native, { thread_id: destination.bundle.codex.thread_id, session_id: destination.bundle.codex.session_id, cwd: destination.checkout, rollout: join(destination.home, destination.bundle.codex.root), history: destination.bundle.history }); }
      finally { await native.close(); }
      return { state: "resumed", destination: { machine_id: text(payload.machine_id), herdr_lifetime: destination.lifetime, pane_id: destination.pane_id,
        native_session_id: destination.bundle.codex.thread_id, checkout: destination.checkout, history_sha256: destination.bundle.history } satisfies SessionMoveDestination };
    }
    throw new MoveRefused("invalid_move_action", "Unsupported transfer operation");
  }
}

function bundleValue(bundle: TransferBundle): void {
  if (bundle?.version !== 1 || bundle.checkout?.version !== 1 || bundle.codex?.version !== 1 || !/^[a-f0-9]{64}$/.test(bundle.history) || !Array.isArray(bundle.files)) throw new MoveRefused("invalid_manifest", "Invalid native transfer bundle");
  const expected = [bundle.checkout.bundle, bundle.checkout.staged, bundle.checkout.unstaged, ...bundle.checkout.untracked.map((file) => ({ ...file, path: `untracked/${file.path}` })), ...bundle.codex.files.map((file) => ({ ...file, path: `codex/${file.path}` })), ...(bundle.codex.history_index ? [bundle.codex.history_index] : [])];
  if (JSON.stringify(expected) !== JSON.stringify(bundle.files) || bundle.checkout.bundle.path !== "commits.bundle" || bundle.checkout.staged.path !== "staged.patch" || bundle.checkout.unstaged.path !== "unstaged.patch") throw new MoveRefused("invalid_manifest", "Transfer files do not match the native snapshot");
}
function destinationPath(path: string): string {
  if (!isAbsolute(path) || basename(path).startsWith(".") || relative(realpathSync(dirname(path)), dirname(path)) !== "") throw new MoveRefused("unsafe_path", "Choose a new checkout under an existing real directory");
  return path;
}
function publishCheckout(staging: string, destination: string, id: string): void {
  if (existsSync(destination)) {
    const marker = join(destination, ".ovis-move-owner");
    if (!existsSync(marker) || readMoveFile(destination, ".ovis-move-owner").data.toString() !== id) throw new MoveRefused("destination_conflict", "Destination checkout already exists");
    return;
  }
  // The private marker travels with the checkout; retries never adopt an unrelated existing directory.
  writePrivateState(join(staging, ".ovis-move-receipt.json"), { version: 1, operation: id });
  const marker = { path: ".ovis-move-owner", bytes: Buffer.byteLength(id), sha256: digest(Buffer.from(id)), executable: false };
  writeMoveFile(staging, marker, Buffer.from(id));
  // An empty, exclusive reservation prevents overwriting an existing checkout.
  mkdirSync(destination, { mode: 0o700 });
  try { renameSync(staging, destination); }
  catch (error) { if (readdirSync(destination).length === 0) rmSync(destination); throw error; }
}
function nativeThreadConflict(home: string, id: string): void {
  const path = inside(home, "state_5.sqlite", true);
  if (!existsSync(path)) return;
  const db = new Database(path, { readonly: true, create: false });
  try { if (db.query("SELECT 1 FROM threads WHERE id = ?").get(id)) throw new MoveRefused("destination_conflict", "Destination already knows this native thread"); }
  finally { db.close(); }
}
function auxiliary(home: string, id: string): void {
  for (const [file, tables] of [["state_5.sqlite", ["thread_attachments", "thread_artifacts", "thread_dynamic_tools"]], ["queue_1.sqlite", ["queued_items"]], ["goals_1.sqlite", ["thread_goals"]], ["thread_goals_1.sqlite", ["thread_goals"]]] as const) {
    const path = inside(home, file, true); if (!existsSync(path)) continue;
    const db = new Database(path, { readonly: true, create: false });
    try { for (const table of tables) if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) && db.query(`SELECT 1 FROM ${table} WHERE thread_id = ? LIMIT 1`).get(id)) throw new MoveRefused("unsupported_artifact", "Clear native queued work, goals, attachments and custom tools before moving"); }
    finally { db.close(); }
  }
}
