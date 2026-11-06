import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const MAX_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 256;
const MAX_RECORDS = 4096;
const fingerprint = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const fileId = (info: { dev: number; ino: number }): string => `${info.dev}:${info.ino}`;
const textOf = (text: string): string => text.replace(/\r\n?/gu, "\n").trimEnd();

export interface CodexDeliveryAnchor {
  path: string;
  file: string;
  session: string;
  size: number;
  tail: string;
}

async function bytesAt(fd: FileHandle, start: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await fd.read(bytes, read, length - read, start + read);
    if (result.bytesRead === 0) throw new Error("Codex transcript changed during read");
    read += result.bytesRead;
  }
  return bytes;
}

async function sessionOf(fd: FileHandle, size: number): Promise<string | null> {
  const head = await bytesAt(fd, 0, Math.min(size, 32 * 1024));
  const end = head.indexOf(10);
  if (end < 0) return null;
  const entry = JSON.parse(head.subarray(0, end).toString("utf8"));
  return entry.type === "session_meta" && typeof entry.payload?.id === "string" && entry.payload.id !== "" ? entry.payload.id : null;
}

async function tailOf(fd: FileHandle, size: number): Promise<string> {
  const start = Math.max(0, size - 512);
  return fingerprint(await bytesAt(fd, start, size - start));
}

/** Capture a bound native file before Enter; an incomplete or changing file supplies no evidence. */
export async function captureCodexDelivery(path: string): Promise<CodexDeliveryAnchor | null> {
  let fd: FileHandle | undefined;
  try {
    fd = await open(path, "r");
    const before = await fd.stat();
    if (!before.isFile() || before.size === 0 || (await bytesAt(fd, before.size - 1, 1))[0] !== 10) return null;
    const session = await sessionOf(fd, before.size);
    if (session === null) return null;
    const tail = await tailOf(fd, before.size), after = await fd.stat(), named = await stat(path);
    if (fileId(before) !== fileId(named) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return null;
    return { path, file: fileId(before), session, size: before.size, tail };
  } catch { return null; }
  finally { await fd?.close().catch(() => {}); }
}

type Attempt<T> = { pane: string; text: string; anchor: CodexDeliveryAnchor | null; at: number; value: T };
type NativeMessage = { key: string; start: number; at: number; text: string };

/**
 * Receipt evidence only: every known Codex Chat send, including successful ordinary sends,
 * reserves its native echo. A native event can settle one attempt, never two identical sends.
 */
export class CodexDeliveries<T> {
  private attempts = new Set<Attempt<T>>();
  private consumed = new Map<string, Set<string>>();
  private blocked = new Map<string, string>();
  private exhausted = false;
  private source(anchor: CodexDeliveryAnchor): string { return JSON.stringify([anchor.path, anchor.file, anchor.session]); }
  invalidate(pane: string): void {
    const anchor = [...this.attempts].find((item) => item.pane === pane && item.anchor !== null)?.anchor;
    if ([...this.attempts].some((item) => item.pane === pane)) this.blocked.set(pane, anchor ? this.source(anchor) : "unbound");
    if (this.blocked.size >= MAX_ATTEMPTS) this.exhausted = true;
    this.forget(pane);
  }

  add(pane: string, text: string, anchor: CodexDeliveryAnchor | null, at: number, value: T): void {
    if (this.exhausted || /^\s*[/!]/u.test(text)) return;
    const source = anchor === null ? "unbound" : this.source(anchor);
    const blocked = this.blocked.get(pane);
    if (blocked === "unbound" || blocked === source || anchor === null && blocked !== undefined) return;
    this.blocked.delete(pane);
    // Never forget an unobserved ordinary send and then give its delayed echo to another send.
    if (this.attempts.size >= MAX_ATTEMPTS) {
      const oldest = this.attempts.values().next().value!;
      this.invalidate(oldest.pane);
      if (oldest.pane === pane || this.exhausted) return;
    }
    this.attempts.add({ pane, text: textOf(text), anchor, at, value });
  }

  values(pane: string): T[] { return [...this.attempts].filter((item) => item.pane === pane).map((item) => item.value); }

  forget(pane: string): void {
    for (const item of this.attempts) if (item.pane === pane) this.attempts.delete(item);
    this.consumed.delete(pane);
  }

  async reconcile(pane: string, path: string): Promise<T[]> {
    const attempts = [...this.attempts].filter((item) => item.pane === pane);
    if (attempts.length === 0) return [];
    let fd: FileHandle | undefined;
    try {
      fd = await open(path, "r");
      const before = await fd.stat(), session = await sessionOf(fd, before.size);
      const anchors = attempts.flatMap((item) => item.anchor === null ? [] : [item.anchor]);
      if (anchors.length === 0) return [];
      const first = Math.min(...anchors.map((anchor) => anchor.size));
      if (before.size < first || before.size - first > MAX_BYTES) { this.invalidate(pane); return []; }
      for (const anchor of anchors) {
        if (anchor.path !== path || anchor.file !== fileId(before) || anchor.session !== session || before.size < anchor.size
          || anchor.tail !== await tailOf(fd, anchor.size)) { this.invalidate(pane); return []; }
      }
      const bytes = await bytesAt(fd, first, before.size - first);
      const records: NativeMessage[] = [];
      let offset = 0, lines = 0;
      for (let end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, offset)) {
        if (++lines > MAX_RECORDS) { this.invalidate(pane); return []; }
        const start = first + offset, entry = JSON.parse(bytes.subarray(offset, end).toString("utf8"));
        offset = end + 1;
        const payload = entry.payload;
        // response_item/user is a model-context copy, not another accepted TUI message.
        if (entry.type !== "event_msg" || payload?.type !== "user_message" || payload.kind && payload.kind !== "plain" || typeof payload.message !== "string") continue;
        const at = Date.parse(entry.timestamp);
        if (Number.isFinite(at)) records.push({ key: `${fileId(before)}:${session}:${start}`, start, at, text: textOf(payload.message) });
      }
      const after = await fd.stat(), named = await stat(path);
      if (fileId(before) !== fileId(named) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return [];
      for (const anchor of anchors) if (anchor.tail !== await tailOf(fd, anchor.size)) { this.invalidate(pane); return []; }
      const consumed = this.consumed.get(pane) ?? new Set<string>();
      this.consumed.set(pane, consumed);
      const candidates = attempts.filter((item) => this.attempts.has(item)).map((item) => ({ item, records: records.filter((record) => !consumed.has(record.key)
        && record.start >= (item.anchor?.size ?? first) && record.at >= item.at && record.text === item.text) }));
      const counts = new Map<string, number>();
      for (const candidate of candidates) for (const record of candidate.records) counts.set(record.key, (counts.get(record.key) ?? 0) + 1);
      const confirmed: T[] = [];
      for (const candidate of candidates) {
        const record = candidate.records[0];
        if (candidate.records.length !== 1 || !record || counts.get(record.key) !== 1) continue;
        consumed.add(record.key);
        this.attempts.delete(candidate.item);
        // An unbound earlier send reserves its possible echo but cannot settle a warning.
        if (candidate.item.anchor !== null) confirmed.push(candidate.item.value);
      }
      if (consumed.size >= MAX_RECORDS) this.invalidate(pane);
      else if (![...this.attempts].some((item) => item.pane === pane)) this.forget(pane);
      return confirmed;
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
    finally { await fd?.close().catch(() => {}); }
  }
}
