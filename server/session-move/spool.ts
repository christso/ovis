import { closeSync, constants, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, realpathSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { writePrivateState } from "../private-state.ts";
import { digest, inside, MAX_MOVE_BYTES, movePath, MoveRefused, readMoveFile, writeMoveFile, type MoveFile } from "./files.ts";
import { MOVE_CHUNK_BYTES } from "./transport.ts";

export interface MoveManifest { version: 1; files: MoveFile[] }
export const operationId = (id: unknown): string => {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new MoveRefused("invalid_operation", "Invalid move operation ID");
  return id;
};
/** Private per-operation byte receipts. Repeated chunks verify existing bytes; gaps and overlaps never truncate data. */
export class MoveSpool {
  readonly root: string;
  constructor(stateDir: string, id: string) {
    operationId(id); mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.root = inside(realpathSync(stateDir), `move-spool/${id}`, true);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  private document(): MoveManifest {
    let value: MoveManifest;
    try { value = JSON.parse(readMoveFile(this.root, "manifest.json", 4 * 1024 * 1024).data.toString()); }
    catch { throw new MoveRefused("invalid_manifest", "Transfer manifest cannot be read; existing bytes were preserved"); }
    this.validate(value); return value;
  }
  private validate(value: MoveManifest): void {
    if (value?.version !== 1 || !Array.isArray(value.files) || value.files.length > 20_000 || new Set(value.files.map((file) => file.path)).size !== value.files.length) throw new MoveRefused("invalid_manifest", "Unsupported transfer manifest");
    let bytes = 0;
    for (const file of value.files) {
      movePath(file.path);
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== "boolean") throw new MoveRefused("invalid_manifest", "Invalid transfer file metadata");
      bytes += file.bytes;
    }
    if (bytes > 2 * MAX_MOVE_BYTES) throw new MoveRefused("snapshot_too_large", "Transfer exceeds the supported aggregate size");
  }
  offer(manifest: MoveManifest): void {
    this.validate(manifest);
    if (existsSync(join(this.root, "manifest.json"))) {
      if (JSON.stringify(this.document()) !== JSON.stringify(manifest)) throw new MoveRefused("manifest_conflict", "This operation already owns a different transfer manifest");
      return;
    }
    writePrivateState(inside(this.root, "manifest.json", true), manifest);
  }
  offset(index: number): number {
    const file = this.file(index), complete = inside(this.root, `complete/${index}`, true);
    if (existsSync(complete)) { const item = readMoveFile(this.root, `complete/${index}`); if (item.file.sha256 !== file.sha256 || item.file.bytes !== file.bytes) throw new MoveRefused("corrupt_transfer", "Completed transfer file changed"); return file.bytes; }
    const info = statSync(inside(this.root, `partial/${index}`, true), { throwIfNoEntry: false });
    if (info && (!info.isFile() || info.size > file.bytes)) throw new MoveRefused("corrupt_transfer", "Partial transfer is invalid");
    return info?.size ?? 0;
  }
  private file(index: number): MoveFile {
    if (!Number.isSafeInteger(index) || index < 0) throw new MoveRefused("invalid_file", "Invalid transfer file index");
    const file = this.document().files[index];
    if (!file) throw new MoveRefused("invalid_file", "Transfer file was not found"); return file;
  }
  put(index: number, offset: number, data: Uint8Array): number {
    const file = this.file(index);
    if (!Number.isSafeInteger(offset) || offset < 0 || data.length > MOVE_CHUNK_BYTES || offset + data.length > file.bytes) throw new MoveRefused("invalid_chunk", "Invalid transfer chunk");
    const complete = inside(this.root, `complete/${index}`, true);
    if (existsSync(complete)) {
      const bytes = readMoveFile(this.root, `complete/${index}`).data;
      if (digest(bytes) !== file.sha256 || !bytes.subarray(offset, offset + data.length).equals(data)) throw new MoveRefused("chunk_conflict", "Transfer chunk differs from completed data");
      return file.bytes;
    }
    mkdirSync(inside(this.root, "partial", true), { recursive: true, mode: 0o700 });
    const fd = openSync(inside(this.root, `partial/${index}`, true), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const size = fstatSync(fd).size;
      if (offset < size) {
        const prior = Buffer.alloc(data.length);
        if (offset + data.length > size || readSync(fd, prior, 0, prior.length, offset) !== prior.length || !prior.equals(data)) throw new MoveRefused("chunk_conflict", "Repeated transfer chunk differs from stored data");
      } else {
        if (offset !== size) throw new MoveRefused("chunk_gap", "Resume transfer at its acknowledged offset");
        for (let written = 0; written < data.length;) { const count = writeSync(fd, data, written, data.length - written, offset + written); if (!count) throw new Error("write stalled"); written += count; }
        fsyncSync(fd);
      }
    } finally { closeSync(fd); }
    const size = statSync(inside(this.root, `partial/${index}`)).size;
    if (size === file.bytes) {
      const item = readMoveFile(this.root, `partial/${index}`);
      if (item.file.sha256 !== file.sha256) throw new MoveRefused("corrupt_transfer", "Transferred file checksum differs from its manifest");
      mkdirSync(inside(this.root, "complete", true), { recursive: true, mode: 0o700 }); renameSync(inside(this.root, `partial/${index}`), complete);
    }
    return size;
  }
  materialize(destination: string): void {
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    this.document().files.forEach((file, index) => {
      const item = readMoveFile(this.root, `complete/${index}`);
      const path = inside(destination, file.path, true);
      if (existsSync(path)) {
        const existing = readMoveFile(destination, file.path);
        if (existing.file.sha256 !== file.sha256 || existing.file.bytes !== file.bytes) throw new MoveRefused("destination_conflict", "Transferred staging file differs from its receipt");
      } else writeMoveFile(destination, file, item.data);
    });
  }
}
