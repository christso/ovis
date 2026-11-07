import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { digest, inside, MAX_MOVE_BYTES, MoveRefused, readMoveFile, writeMoveFile, type MoveFile } from "./files.ts";
import { restoreHistoryIndex, snapshotHistoryIndex, type CodexHistoryIndex, type CodexHistoryScope } from "./history-index.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ID = new RegExp(`^${UUID}$`, "i");
const NAME = new RegExp(`^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-(${UUID})(?:_(${UUID}))?\\.jsonl$`, "i");
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};

const historyFingerprint = (files: readonly MoveFile[]): string => digest(Buffer.from(JSON.stringify(files.map((file) => [file.path, file.bytes, file.sha256]))));

export interface CodexMoveRuntime { version: string; platform: string; native_resume: boolean; authenticated: boolean }
export interface CodexSnapshot {
  version: 1;
  cli_version: "0.166.0";
  thread_id: string;
  session_id: string;
  root: string;
  cwd: string;
  files: MoveFile[];
  checkout_artifacts: string[];
  history_sha256: string;
  history_index: MoveFile | null;
  history_scope: CodexHistoryScope | null;
}

/** Exact versions until owned-fixture native resume has qualified another format/runtime pair. */
export function codexCompatibility(source: CodexMoveRuntime, destination: CodexMoveRuntime): void {
  if (source.version !== "0.166.0" || destination.version !== source.version
    || !["linux", "darwin"].includes(source.platform) || !["linux", "darwin"].includes(destination.platform)
    || !source.native_resume || !destination.native_resume) throw new MoveRefused("codex_incompatible", "Session moves require Codex 0.166.0 and native resume on Linux or macOS");
  if (!destination.authenticated) throw new MoveRefused("destination_signed_out", "Sign in to Codex on the destination before moving");
}

interface Rollout { path: string; data: Buffer; file: MoveFile; meta: ObjectValue; records: ObjectValue[]; rolloutId: string; first: number }
function rollout(home: string, path: string, remaining: number): Rollout {
  if (!/^(?:sessions|archived_sessions)\//.test(path)) throw new MoveRefused("unsupported_rollout", "Rollout is outside the native session store");
  const name = NAME.exec(basename(path));
  if (!name) throw new MoveRefused("unsupported_rollout", "Compressed or unrecognized rollouts cannot be moved");
  const { data, file } = readMoveFile(home, path, remaining);
  if (!data.length || data.at(-1) !== 10) throw new MoveRefused("incomplete_rollout", "Codex rollout has an incomplete final record");
  let records: ObjectValue[];
  try { records = data.toString("utf8").trimEnd().split("\n").map((line) => object(JSON.parse(line))); }
  catch { throw new MoveRefused("invalid_rollout", "Codex rollout contains malformed records"); }
  const meta = object(records[0]?.payload);
  if (records[0]?.type !== "session_meta" || meta.id !== name[1] || meta.cli_version !== "0.166.0"
    || typeof meta.cwd !== "string" || !isAbsolute(meta.cwd) || !["legacy", "paginated", undefined].includes(meta.history_mode as string | undefined)) throw new MoveRefused("unsupported_rollout", "Codex rollout metadata or history format is unsupported");
  if (meta.parent_thread_id || meta.agent_role || meta.attached_thread || meta.multi_agent_version === "v2"
    || (meta.source !== "cli" && meta.source !== "vscode") || Object.keys(object(meta.source)).length
    || (Array.isArray(meta.dynamic_tools) && meta.dynamic_tools.length) || (Array.isArray(meta.selected_capability_roots) && meta.selected_capability_roots.length)) throw new MoveRefused("unsupported_runtime", "Subagents, attached forks and custom runtime capabilities cannot be moved");
  const first = object(meta.history_base).end_ordinal_exclusive ?? 0;
  if (!Number.isSafeInteger(first) || (first as number) < 0) throw new MoveRefused("invalid_history_base", "Invalid Codex history boundary");
  return { path, data, file, records, meta, rolloutId: (name[2] ?? name[1])!, first: first as number };
}

/** Metadata-only discovery, bounded independently of the chosen thread's bytes. */
function candidates(home: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let entries = 0;
  const walk = (name: string, depth: number): void => {
    if (depth > 5) throw new MoveRefused("unsupported_store", "Codex session store is nested too deeply");
    let children;
    try { children = readdirSync(inside(home, name), { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const child of children) {
      if (++entries > 100_000) throw new MoveRefused("store_too_large", "Codex store discovery limit exceeded");
      if (child.isSymbolicLink()) throw new MoveRefused("unsafe_path", "Codex session store contains a symbolic link");
      const path = `${name}/${child.name}`;
      if (child.isDirectory()) walk(path, depth + 1);
      const named = NAME.exec(child.name);
      if (child.isFile() && named) {
        const id = (named[2] ?? named[1])!;
        found.set(id, [...found.get(id) ?? [], path]);
      }
    }
  };
  walk("sessions", 0); walk("archived_sessions", 0);
  return found;
}

/** Actual native file references, not arbitrary paths mentioned in conversation prose. */
function artifacts(value: unknown, output: Set<string>, depth = 0): void {
  if (depth > 64) throw new MoveRefused("invalid_rollout", "Codex record nesting is unsupported");
  if (Array.isArray(value)) { for (const child of value) artifacts(child, output, depth + 1); return; }
  const item = object(value);
  if ((item.type === "input_file" && !item.file_data) || item.file_id || item.attachment_id || (Array.isArray(item.file_ids) && item.file_ids.length)) throw new MoveRefused("unsupported_artifact", "Stored file attachments require a native export and cannot be moved");
  if (["local_image", "ImageView"].includes(item.type as string) && typeof item.path === "string") {
    output.add(item.path.startsWith("file:") ? fileURLToPath(item.path) : item.path);
  }
  if (Array.isArray(item.local_images)) for (const path of item.local_images) {
    if (typeof path !== "string") throw new MoveRefused("unsupported_artifact", "Unrecognized Codex image reference");
    output.add(path);
  }
  if (item.type === "input_image" && typeof item.image_url === "string" && !item.image_url.startsWith("data:")) throw new MoveRefused("unsupported_artifact", "Non-inline image URLs require a separate artifact transfer");
  for (const child of Object.values(item)) if (typeof child === "object" && child !== null) artifacts(child, output, depth + 1);
}

/**
 * Copy byte-exact native files, oldest first. history_base.thread_id is a rollout ID, NOT
 * necessarily a stable thread ID (0.166.0 protocol.rs HistoryPosition / rollout_file_name.rs).
 * Full referenced files preserve native cache checkpoints; inherited boundaries remain unchanged.
 * Preview must disclose that referenced prefix files may also contain discarded/reverted tails.
 */
export function snapshotCodex(home: string, root: string, threadId: string, staging: string): CodexSnapshot {
  if (!ID.test(threadId)) throw new MoveRefused("invalid_thread", "A native Codex thread UUID is required");
  const index = candidates(home), chain: Rollout[] = [], visited = new Set<string>();
  let current = root, total = 0, end: number | undefined, ordinal: number | undefined;
  const indexRanges: { id: string; bytes: number; required_ordinal: number }[] = [];
  for (;;) {
    if (chain.length >= 64 || visited.has(current)) throw new MoveRefused("invalid_history_base", "Codex history has a cycle or exceeds the supported depth");
    visited.add(current);
    const item = rollout(home, current, MAX_MOVE_BYTES - total);
    if (chain.length === 0 && item.meta.id !== threadId) throw new MoveRefused("thread_mismatch", "Selected rollout does not belong to the source thread");
    if (end !== undefined) {
      if (!Number.isSafeInteger(end) || end <= 0 || end > item.data.length || item.data[end - 1] !== 10) throw new MoveRefused("invalid_history_base", "Codex inherited history boundary does not match its file");
      const prefix = item.data.subarray(0, end);
      item.records = prefix.toString("utf8").trimEnd().split("\n").map((line) => object(JSON.parse(line)));
      const ordinals = item.records.map((record) => record.ordinal);
      if (ordinals.some((value, index) => !Number.isSafeInteger(value) || (value as number) < item.first || (index > 0 && (value as number) <= (ordinals[index - 1] as number)))
        || (ordinals.at(-1) as number) + 1 !== ordinal) throw new MoveRefused("invalid_history_base", "Codex inherited ordinal boundary does not match its records");
      indexRanges.push({ id: item.rolloutId, bytes: item.data.length, required_ordinal: ordinal! });
    }
    total += item.data.length;
    chain.push(item);
    const base = object(item.meta.history_base);
    if (!Object.keys(base).length) break;
    if (typeof base.thread_id !== "string" || !ID.test(base.thread_id) || !Number.isSafeInteger(base.end_ordinal_exclusive) || !Number.isSafeInteger(base.end_byte_offset)) throw new MoveRefused("invalid_history_base", "Codex history has an invalid inherited file reference");
    const matches = index.get(base.thread_id) ?? [];
    if (matches.length !== 1) throw new MoveRefused("missing_history_base", "Codex inherited history file is missing or ambiguous");
    current = matches[0]!; end = base.end_byte_offset as number; ordinal = base.end_ordinal_exclusive as number;
  }
  const selected = chain[0]!, refs = new Set<string>();
  for (const item of chain) artifacts(item.records, refs);
  const checkout = selected.meta.cwd as string;
  const checkoutArtifacts = [...refs].map((path) => {
    const name = relative(checkout, resolve(checkout, path)).split("\\").join("/");
    inside(checkout, name);
    return name;
  }).sort();
  let historyIndex: MoveFile | null = null, historyScope: CodexHistoryScope | null = null;
  if (indexRanges.length) {
    const index = snapshotHistoryIndex(home, indexRanges);
    historyScope = { schema: index.schema, rollout_ids: index.rollout_ids };
    const data = Buffer.from(JSON.stringify(index));
    if (total + data.length > MAX_MOVE_BYTES) throw new MoveRefused("snapshot_too_large", "Codex snapshot and history index exceed the transfer limit");
    historyIndex = { path: "history-index.json", bytes: data.length, sha256: digest(data), executable: false };
    writeMoveFile(staging, historyIndex, data);
  }
  const files = chain.reverse().map((item) => {
    const file = { ...item.file, path: item.path.replace(/^archived_sessions\//, "sessions/") };
    writeMoveFile(staging, { ...file, path: `codex/${file.path}` }, item.data);
    return file;
  });
  return { version: 1, cli_version: "0.166.0", thread_id: threadId, session_id: typeof selected.meta.session_id === "string" ? selected.meta.session_id : threadId,
    root: root.replace(/^archived_sessions\//, "sessions/"), cwd: checkout, files, checkout_artifacts: checkoutArtifacts, history_index: historyIndex, history_scope: historyScope,
    history_sha256: historyFingerprint(files) };
}

/** Restore only into an operation-owned empty Codex staging home. Never overwrite a user's store. */
export function restoreCodex(snapshot: CodexSnapshot, staging: string, destinationHome: string, destinationCwd: string): void {
  if (snapshot.version !== 1 || snapshot.cli_version !== "0.166.0") throw new MoveRefused("invalid_snapshot", "Unsupported Codex snapshot");
  if (snapshot.checkout_artifacts.length && snapshot.cwd !== destinationCwd) throw new MoveRefused("artifact_path_conflict", "Image-bearing sessions currently require the same absolute checkout path on the destination");
  const expected = historyFingerprint(snapshot.files);
  if (expected !== snapshot.history_sha256) throw new MoveRefused("corrupt_transfer", "Codex snapshot manifest failed its checksum");
  for (const file of snapshot.files) {
    if (!/^sessions\//.test(file.path)) throw new MoveRefused("unsafe_path", "Codex transfer may only write native session files");
    const item = readMoveFile(staging, `codex/${file.path}`);
    writeMoveFile(destinationHome, file, item.data);
  }
}

/** Run after the installed destination CLI has initialized its own history schema, before resume. */
export function restoreCodexHistory(snapshot: CodexSnapshot, staging: string, destinationHome: string, acceptIdentical = false): void {
  if (!snapshot.history_index) {
    if (snapshot.files.length > 1) throw new MoveRefused("incomplete_history_index", "Segmented history requires its native index");
    return;
  }
  const item = readMoveFile(staging, snapshot.history_index.path);
  if (item.file.sha256 !== snapshot.history_index.sha256 || item.file.bytes !== snapshot.history_index.bytes) throw new MoveRefused("corrupt_transfer", "Codex history index failed its checksum");
  const index = JSON.parse(item.data.toString("utf8")) as CodexHistoryIndex;
  if (JSON.stringify(snapshot.history_scope) !== JSON.stringify({ schema: index.schema, rollout_ids: index.rollout_ids })) throw new MoveRefused("invalid_history_index", "Native history scope differs from its confirmed snapshot");
  restoreHistoryIndex(destinationHome, index, acceptIdentical);
}
