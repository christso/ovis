import type { HerdrCoordinationPage, HerdrCoordinationReceipt } from "../shared/flock.ts";
import { flockCoordinationPageValue, flockHerdrEndpointMetadata } from "../shared/flock-relationships.ts";
import { agentCoordinationList, herdrSocketPath } from "./herdr/client.ts";

interface Scan { server: string; boot: string; cursor: string | null; receipts: Map<string, HerdrCoordinationReceipt> }
const scans = new Map<string, Scan>();
const pending = new Map<string, Promise<HerdrCoordinationPage | undefined>>();
const PAGES_PER_READ = 4;

/** Read only the optional fork extension. Stock daemons remain usable without attributed relationships. */
export function herdrCoordinationSnapshot(socketPath = herdrSocketPath()): Promise<HerdrCoordinationPage | undefined> {
  const running = pending.get(socketPath);
  if (running) return running;
  const read = collect(socketPath).finally(() => pending.delete(socketPath));
  pending.set(socketPath, read);
  return read;
}

async function collect(socketPath: string): Promise<HerdrCoordinationPage | undefined> {
  const old = scans.get(socketPath);
  let scan = old ? { ...old, receipts: new Map(old.receipts) } : undefined;
  let last: HerdrCoordinationPage | undefined;
  for (let index = 0; index < PAGES_PER_READ; index += 1) {
    let requestedCursor = scan?.cursor ?? null;
    let raw: unknown;
    try {
      raw = await agentCoordinationList(scan?.cursor ?? undefined, socketPath);
    } catch {
      if (!scan?.cursor || index + 1 >= PAGES_PER_READ) return undefined;
      index += 1;
      try { raw = await agentCoordinationList(undefined, socketPath); } catch { return undefined; }
      if (!flockCoordinationPageValue(raw) || (raw.server_id === scan.server && raw.boot_id === scan.boot)) return undefined;
      scan = undefined;
      requestedCursor = null;
    }
    if (!flockCoordinationPageValue(raw)) return undefined;
    if (scan && (scan.server !== raw.server_id || scan.boot !== raw.boot_id)) {
      scan = undefined;
      // The old cursor belongs to another daemon incarnation. Restart before consuming its history.
      if (index + 1 < PAGES_PER_READ) continue;
      return undefined;
    }
    scan ??= { server: raw.server_id, boot: raw.boot_id, cursor: null, receipts: new Map() };
    for (const receipt of raw.receipts) if (!scan.receipts.has(receipt.id)) scan.receipts.set(receipt.id, {
      id: receipt.id, kind: receipt.kind, source: flockHerdrEndpointMetadata(receipt.source), target: flockHerdrEndpointMetadata(receipt.target), occurred_at: receipt.occurred_at,
    });
    last = raw;
    if (raw.cursor === scan.cursor && raw.cursor !== null) return undefined;
    // Re-read the final page on the next poll, so later appends are found without rescanning old pages.
    scan.cursor = raw.cursor ?? requestedCursor;
    if (raw.cursor === null) break;
  }
  if (!last || !scan) return undefined;
  const result = { version: 1 as const, server_id: last.server_id, boot_id: last.boot_id, agents: last.agents.map(flockHerdrEndpointMetadata), receipts: [...scan.receipts.values()], cursor: last.cursor };
  scans.set(socketPath, scan);
  return result;
}
