import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { GraphObservation } from "../shared/graph-registry.ts";
import { graphObservationValue } from "../shared/graph-relationships.ts";

const READ_BYTES = 4 * 1024 * 1024;
const LINE_BYTES = 256 * 1024;
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
interface Scan {
  path: string; identity: string; header: string; fileSize: number; modified: number; changed: number;
  offset: number; skipLine: boolean; events: Map<string, GraphObservation>;
}
const scans = new Map<string, Scan>();
const pending = new Map<string, Promise<GraphObservation[]>>();

/** Prune after a verified source census, so active panes keep progress and inactive histories leave memory. */
export function retainCodexCoordinationScans(activePaths: ReadonlySet<string>): void {
  for (const [key, scan] of scans) if (!activePaths.has(scan.path)) scans.delete(key);
}

/** Completed v2 activity items are emitted after native spawn/send succeeds. Arguments alone are not receipts. */
function observation(value: unknown, ownId: string): GraphObservation | null {
  const entry = row(value), payload = row(entry.payload), item = row(payload.item);
  if (entry.type !== "event_msg" || payload.type !== "item_completed" || payload.thread_id !== ownId || item.type !== "SubAgentActivity"
    || (item.kind !== "started" && item.kind !== "interacted")) return null;
  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  const event = { id: item.id, kind: item.kind === "started" ? "delegation" : "communication", source_native_session_id: ownId,
    target_native_session_id: typeof item.agent_thread_id === "string" ? item.agent_thread_id.toLowerCase() : item.agent_thread_id,
    occurred_at: new Date(timestamp).toISOString(), source: "codex" };
  return graphObservationValue(event) ? event : null;
}

/**
 * Read the exact rollout already proven by codexTranscriptPath, never a browser path. Scans advance
 * from the beginning over complete lines, at most 4MB per poll; large histories catch up over polls.
 * Only receipt metadata survives the scan. Legacy unscoped events and ambiguous v1 tool items are omitted.
 */
export function codexCoordinationObservations(path: string, ownId: string): Promise<GraphObservation[]> {
  const key = `${path}\u0000${ownId}`;
  const running = pending.get(key);
  if (running) return running;
  const result = scan(path, ownId, key).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}

async function scan(path: string, ownId: string, key: string): Promise<GraphObservation[]> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = await file.stat();
    if (!before.isFile()) { scans.delete(key); return []; }
    const identity = `${before.dev}:${before.ino}`;
    const head = Buffer.alloc(Math.min(before.size, LINE_BYTES + 1));
    const readHead = await file.read(head, 0, head.length, 0);
    const endHeader = head.subarray(0, readHead.bytesRead).indexOf(0x0a);
    if (endHeader < 0 || endHeader > LINE_BYTES) { scans.delete(key); return []; }
    const headerBytes = head.subarray(0, endHeader);
    let header: Row;
    try { header = row(JSON.parse(headerBytes.toString("utf8"))); } catch { scans.delete(key); return []; }
    if (header.type !== "session_meta" || row(header.payload).id !== ownId) { scans.delete(key); return []; }
    const fingerprint = createHash("sha256").update(headerBytes).digest("hex");
    const known = scans.get(key);
    const reusable = known && known.identity === identity && known.header === fingerprint && before.size >= known.fileSize
      && (before.size > known.fileSize || (before.mtimeMs === known.modified && before.ctimeMs === known.changed));
    const current: Scan = reusable ? { ...known, events: new Map(known.events) }
      : { path, identity, header: fingerprint, fileSize: before.size, modified: before.mtimeMs, changed: before.ctimeMs, offset: endHeader + 1, skipLine: false, events: new Map() };
    const bytes = Buffer.alloc(Math.min(READ_BYTES, Math.max(0, before.size - current.offset)));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, current.offset);
    let at = 0;
    while (at < bytesRead) {
      const end = bytes.subarray(0, bytesRead).indexOf(0x0a, at);
      if (end < 0) {
        if (current.skipLine || bytesRead - at > LINE_BYTES) { current.offset += bytesRead - at; current.skipLine = true; }
        break;
      }
      if (!current.skipLine && end - at <= LINE_BYTES) {
        try {
          const event = observation(JSON.parse(bytes.subarray(at, end).toString("utf8")), ownId);
          if (event && !current.events.has(event.id)) current.events.set(event.id, event);
        } catch {}
      }
      current.skipLine = false;
      current.offset += end + 1 - at;
      at = end + 1;
    }
    const after = await file.stat(), published = await lstat(path);
    if (published.isSymbolicLink() || `${published.dev}:${published.ino}` !== identity || after.size < before.size
      || (after.size === before.size && (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs))) {
      scans.delete(key); return [];
    }
    current.fileSize = before.size; current.modified = before.mtimeMs; current.changed = before.ctimeMs;
    scans.delete(key); scans.set(key, current);
    return [...current.events.values()];
  } catch { scans.delete(key); return []; }
  finally { await file?.close().catch(() => {}); }
}
