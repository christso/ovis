import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export class MoveRefused extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const MAX_MOVE_BYTES = 256 * 1024 * 1024;

/** Portable relative paths only. A bundle must never address Git internals or a credential home. */
export function movePath(name: string): string {
  if (!name || name.includes("\\") || name.includes(":") || name.includes("\0") || isAbsolute(name)
    || name.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
    || /^[a-z]:/i.test(name)) throw new MoveRefused("unsafe_path", "Transfer contains an unsafe path");
  return name;
}

/** Both roots and every component must be real directories/files, never links. */
export function inside(root: string, name: string, creating = false): string {
  movePath(name);
  const base = resolve(root);
  if (realpathSync(base) !== base) throw new MoveRefused("unsafe_path", "Transfer root contains a symbolic link");
  let path = base;
  for (const part of name.split("/")) {
    path = join(path, part);
    try {
      if (lstatSync(path).isSymbolicLink()) throw new MoveRefused("unsafe_path", "Transfer path contains a symbolic link");
    } catch (error) {
      if (!creating || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (relative(base, path).startsWith("..") || path === base) throw new MoveRefused("unsafe_path", "Transfer path escaped its root");
  return path;
}

export interface MoveFile { path: string; bytes: number; sha256: string; executable: boolean }

/** Read a bounded stable regular file on a no-follow descriptor; never return a partial snapshot. */
export function readMoveFile(root: string, name: string, limit = MAX_MOVE_BYTES): { file: MoveFile; data: Buffer } {
  const path = inside(root, name);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw new MoveRefused("unsupported_file", "Transfer file is not a bounded regular file");
    const data = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(fd, data, offset, data.length - offset, offset);
      if (count === 0) throw new MoveRefused("source_changed", "Source shrank while creating the snapshot");
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (data.length !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || lstatSync(path, { bigint: true }).ino !== before.ino) throw new MoveRefused("source_changed", "Source changed while creating the snapshot");
    return { file: { path: name, bytes: data.length, sha256: digest(data), executable: (before.mode & 0o111n) !== 0n }, data };
  } finally { closeSync(fd); }
}

/** Destination roots are private, operation-owned staging directories, never existing checkouts. */
export function writeMoveFile(root: string, file: MoveFile, data: Uint8Array): void {
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || data.length !== file.bytes || digest(data) !== file.sha256) throw new MoveRefused("corrupt_transfer", "Transferred file failed its checksum");
  const path = inside(root, file.path, true);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, data, { flag: "wx", mode: file.executable ? 0o700 : 0o600 });
}
