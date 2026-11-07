import { dlopen, FFIType } from "bun:ffi";
import { closeSync, constants, mkdirSync, openSync } from "node:fs";
import { inside, MoveRefused } from "./files.ts";

/** No signal, guessed TUI input, pane close or shared-daemon shutdown is a quiescence proof. */
export interface QuiescentSource { readonly thread_id: string; assertHeld(): void; release(): void }
let library: ReturnType<typeof dlopen<{ flock: { args: [typeof FFIType.i32, typeof FFIType.i32]; returns: typeof FFIType.i32 } }>> | undefined;

/**
 * Codex 0.166.0 rollout/src/writer_lock.rs: coordinate lock-file creation, then hold the exact
 * native thread lock. A loaded idle thread still owns it: refuse until its native client exits.
 * Other threads keep running. Never unlink Codex's lock files, including after release.
 */
export function holdQuiescentCodex(home: string, threadId: string): QuiescentSource {
  if (!["linux", "darwin"].includes(process.platform)) throw new MoveRefused("unsupported_platform", "Native Codex writer ownership is supported on Linux and macOS");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(threadId)) throw new MoveRefused("invalid_thread", "A native Codex thread UUID is required");
  library ??= dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
  const directory = inside(home, "thread-writer-locks", true);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const open = (name: string): number => openSync(inside(home, `thread-writer-locks/${name}`, true), constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  const coordination = open(".coordination.lock");
  let fd: number | undefined;
  try {
    if (library.symbols.flock(coordination, 2 | 4) !== 0) throw new MoveRefused("source_busy", "Codex is publishing another session; retry when it finishes");
    fd = open(`${threadId}.lock`);
    if (library.symbols.flock(fd, 2 | 4) !== 0) throw new MoveRefused("source_not_quiescent", "Finish the active turn and exit this session in its native Codex client before moving it");
    let held = true;
    const owned = fd;
    fd = undefined;
    return {
      thread_id: threadId,
      assertHeld() { if (!held) throw new MoveRefused("source_lease_lost", "Source quiescence must be re-established before continuing the move"); },
      release() { if (held) { held = false; closeSync(owned); } },
    };
  } finally { if (fd !== undefined) closeSync(fd); closeSync(coordination); }
}
