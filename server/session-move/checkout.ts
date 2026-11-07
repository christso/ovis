import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { digest, inside, MAX_MOVE_BYTES, MoveRefused, readMoveFile, writeMoveFile, type MoveFile } from "./files.ts";

export interface CheckoutSnapshot {
  version: 1;
  head: string;
  branch: string | null;
  staged: MoveFile;
  unstaged: MoveFile;
  bundle: MoveFile;
  untracked: MoveFile[];
  excluded_untracked: string[];
}

function git(cwd: string, args: string[], input?: Uint8Array): Buffer {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" });
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, env, stdin: input ?? "ignore", stdout: "pipe", stderr: "pipe", maxBuffer: MAX_MOVE_BYTES });
  if (result.exitCode !== 0) throw new MoveRefused("git_failed", "Git could not prepare or restore the checkout");
  return Buffer.from(result.stdout);
}

function changes(root: string): { staged: Buffer; unstaged: Buffer; head: string; untracked: string[] } {
  const tree = git(root, ["ls-tree", "-rz", "HEAD"]).toString().split("\0").filter(Boolean);
  if (tree.some((line) => /^(?:120000|160000) /.test(line))) throw new MoveRefused("unsupported_checkout", "Committed symbolic links and submodules need a separate checkout transfer");
  const flags = git(root, ["ls-files", "-v", "-z"]).toString().split("\0").filter(Boolean);
  if (flags.some((entry) => !entry.startsWith("H "))) throw new MoveRefused("unsupported_checkout", "Clear assume-unchanged or skip-worktree index flags before moving this checkout");
  const modes = git(root, ["ls-files", "--stage", "-z"]).toString().split("\0").filter(Boolean);
  if (modes.some((line) => /^(?:120000|160000) /.test(line) || !/^\d+ [a-f0-9]+ 0\t/.test(line))) {
    throw new MoveRefused("unsupported_checkout", "Resolve conflicts, symbolic links and submodules before moving this checkout");
  }
  const tracked = git(root, ["ls-files", "-z"]).toString().split("\0").filter(Boolean);
  for (const name of tracked) if (lstatSync(join(root, name), { throwIfNoEntry: false })) inside(root, name);
  const attributes = tracked.filter((name) => name.endsWith(".gitattributes"));
  for (const name of attributes) {
    if (existsSync(inside(root, name)) && /(?:^|\s)filter\s*=/.test(readFileSync(inside(root, name), "utf8"))) throw new MoveRefused("unsupported_checkout", "Checkouts using Git content filters need a separate transfer");
  }
  return {
    head: git(root, ["rev-parse", "--verify", "HEAD"]).toString().trim(),
    staged: git(root, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "HEAD", "--"]),
    unstaged: git(root, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--"]),
    untracked: git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean).sort(),
  };
}

/** Stable private checkout capture; final transfer recaptures under native writer ownership. No remote configuration or hooks are copied. */
export function snapshotCheckout(root: string, staging: string, selectedUntracked: readonly string[]): CheckoutSnapshot {
  const before = changes(root);
  if (new Set(selectedUntracked).size !== selectedUntracked.length || selectedUntracked.some((name) => !before.untracked.includes(name))) throw new MoveRefused("untracked_scope", "Choose individual non-ignored untracked files from the preview");
  const branch = git(root, ["branch", "--show-current"]).toString().trim() || null;
  const untracked = selectedUntracked.map((name) => readMoveFile(root, name));
  const total = untracked.reduce((sum, item) => sum + item.data.length, before.staged.length + before.unstaged.length);
  if (total > MAX_MOVE_BYTES) throw new MoveRefused("snapshot_too_large", "Checkout snapshot exceeds the transfer limit");
  git(root, ["bundle", "create", join(staging, "commits.bundle"), "HEAD"]);
  const bundle = readMoveFile(staging, "commits.bundle", MAX_MOVE_BYTES - total).file;
  const store = (path: string, data: Buffer): MoveFile => {
    const file = { path, bytes: data.length, sha256: digest(data), executable: false };
    writeMoveFile(staging, file, data);
    return file;
  };
  const staged = store("staged.patch", before.staged), unstaged = store("unstaged.patch", before.unstaged);
  for (const item of untracked) writeMoveFile(staging, { ...item.file, path: `untracked/${item.file.path}` }, item.data);
  const after = changes(root);
  if (before.head !== after.head || !before.staged.equals(after.staged) || !before.unstaged.equals(after.unstaged) || JSON.stringify(before.untracked) !== JSON.stringify(after.untracked)
    || untracked.some((item) => readMoveFile(root, item.file.path).file.sha256 !== item.file.sha256)) throw new MoveRefused("source_changed", "Checkout changed while creating the snapshot");
  return { version: 1, head: before.head, branch, bundle, staged, unstaged, untracked: untracked.map((item) => item.file), excluded_untracked: before.untracked.filter((name) => !selectedUntracked.includes(name)) };
}

/** A failed restore leaves its private staging directory for inspection; it never replaces an existing destination. */
export function restoreCheckout(snapshot: CheckoutSnapshot, staging: string, destination: string): void {
  if (snapshot.version !== 1 || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(snapshot.head)) throw new MoveRefused("invalid_snapshot", "Unsupported checkout snapshot");
  if (existsSync(destination)) throw new MoveRefused("destination_conflict", "Destination checkout already exists");
  const checked = (file: MoveFile): Buffer => {
    const item = readMoveFile(staging, file.path);
    if (item.file.sha256 !== file.sha256 || item.file.bytes !== file.bytes) throw new MoveRefused("corrupt_transfer", "Checkout snapshot failed its checksum");
    return item.data;
  };
  checked(snapshot.bundle);
  const staged = checked(snapshot.staged), unstaged = checked(snapshot.unstaged);
  const untracked = snapshot.untracked.map((file) => ({ file, data: checked({ ...file, path: `untracked/${file.path}` }) }));
  mkdirSync(destination, { mode: 0o700 });
  git(destination, ["init", "--template="]);
  git(destination, ["fetch", "--no-tags", join(staging, snapshot.bundle.path), "HEAD"]);
  git(destination, ["checkout", "--detach", snapshot.head]);
  if (staged.length) git(destination, ["apply", "--index", "--binary", "-"], staged);
  if (unstaged.length) git(destination, ["apply", "--binary", "-"], unstaged);
  for (const item of untracked) writeMoveFile(destination, item.file, item.data);
  verifyCheckout(snapshot, staging, destination);
}

/** Receipt-independent verification of all committed, staged, working and selected untracked bytes. */
export function verifyCheckout(snapshot: CheckoutSnapshot, staging: string, destination: string): void {
  const staged = readMoveFile(staging, snapshot.staged.path).data, unstaged = readMoveFile(staging, snapshot.unstaged.path).data;
  const restored = changes(destination);
  if (restored.head !== snapshot.head || !restored.staged.equals(staged) || !restored.unstaged.equals(unstaged)) throw new MoveRefused("restore_mismatch", "Restored checkout differs from the snapshot");
  if (JSON.stringify(restored.untracked) !== JSON.stringify(snapshot.untracked.map((file) => file.path).sort())) throw new MoveRefused("restore_mismatch", "Restored untracked scope differs from the snapshot");
  for (const file of snapshot.untracked) {
    const restored = readMoveFile(destination, file.path).file;
    if (restored.sha256 !== file.sha256 || restored.bytes !== file.bytes || restored.executable !== file.executable) throw new MoveRefused("restore_mismatch", "Restored untracked file differs from the snapshot");
  }
}
