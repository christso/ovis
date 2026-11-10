import { GRAPH_STATUSES } from "./graphLabels.ts";
import type { GraphFilters } from "./graphModel.ts";
import type { Positions, Viewport } from "./graphLayout.ts";

export interface GraphState {
  version: 2;
  layout?: "force";
  selected: string;
  filters: GraphFilters;
  groupMachine: boolean;
  legendOpen: boolean;
  positions: Positions;
  viewport: Viewport;
}
export const GRAPH_STORAGE_KEY = "ovis:graph:v2";
export const DEFAULT_GRAPH_STATE: GraphState = {
  version: 2, layout: "force", selected: "", filters: { search: "", status: "", machine: "", focus: "", showCompleted: false, communication: "recent" },
  groupMachine: false, legendOpen: true, positions: {}, viewport: { x: 160, y: 100, k: 1 },
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, limit = 1000) => typeof value === "string" ? value.slice(0, limit) : "";
const finite = (value: unknown, fallback: number, max = 1e6) => typeof value === "number" && Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : fallback;

/** A new isolated key; future versions are refused by readers and writers, never overwritten. */
export function sanitizeGraphState(raw: unknown): GraphState | null {
  const value = record(raw);
  if (value.version !== 2 || (value.layout !== undefined && value.layout !== "force")) return null;
  const filters = record(value.filters), viewport = record(value.viewport);
  const positions: Positions = Object.create(null);
  for (const [id, rawPoint] of Object.entries(record(value.positions)).slice(0, 10000)) {
    const point = record(rawPoint);
    if (typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y)) {
      positions[id] = { x: finite(point.x, 0), y: finite(point.y, 0) };
    }
  }
  return {
    version: 2, layout: "force", selected: str(value.selected, 64_000), groupMachine: value.groupMachine === true, legendOpen: typeof value.legendOpen === "boolean" ? value.legendOpen : true, positions,
    filters: { search: str(filters.search), machine: str(filters.machine), focus: str(filters.focus, 64_000), status: GRAPH_STATUSES.some((status) => status === str(filters.status)) ? str(filters.status) : "", showCompleted: filters.showCompleted === true, communication: filters.communication === "all" || filters.communication === "none" ? filters.communication : "recent" },
    viewport: { x: finite(viewport.x, 160), y: finite(viewport.y, 100), k: Math.max(0.08, finite(viewport.k, 1, 4)) },
  };
}

/** Only graph-owned query fields change; normal Ovis selection and view location stay owned by App. */
export function graphLocation(url: URL, state: GraphState): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries({ gn: state.selected, gq: state.filters.search, gs: state.filters.status, gm: state.filters.machine, gf: state.filters.focus, gc: state.filters.showCompleted ? "1" : "", gg: state.groupMachine ? "1" : "", gcomm: state.filters.communication === "all" || state.filters.communication === "none" ? state.filters.communication : "" })) {
    if (value) next.searchParams.set(key, value); else next.searchParams.delete(key);
  }
  next.searchParams.set("graph", "1");
  return next;
}
export function readGraphLocation(url: URL, fallback: GraphState): GraphState {
  if (url.searchParams.get("graph") !== "1") return fallback;
  const p = url.searchParams;
  return sanitizeGraphState({ ...fallback, selected: p.get("gn"), groupMachine: p.get("gg") === "1", filters: { search: p.get("gq"), status: p.get("gs"), machine: p.get("gm"), focus: p.get("gf"), showCompleted: p.get("gc") === "1", communication: p.get("gcomm") } })!;
}

/** V1 stays intact for old tabs and rollback. Only the first V2 read derives its filters/selection. */
export function loadGraphState(storage: Pick<Storage, "getItem">): { state: GraphState; saved: boolean } {
  let state = DEFAULT_GRAPH_STATE, saved = false;
  try {
    const text = storage.getItem(GRAPH_STORAGE_KEY);
    if (text !== null) {
      const stored = sanitizeGraphState(JSON.parse(text));
      if (stored) {
        state = stored;
        saved = Object.keys(stored.positions).length > 0 || stored.viewport.x !== DEFAULT_GRAPH_STATE.viewport.x || stored.viewport.y !== DEFAULT_GRAPH_STATE.viewport.y || stored.viewport.k !== DEFAULT_GRAPH_STATE.viewport.k;
      }
    } else {
      const legacy = record(JSON.parse(storage.getItem("ovis:graph:v1") ?? "null"));
      if (legacy.version === 1 && (legacy.layout === undefined || legacy.layout === "force")) {
        state = sanitizeGraphState({ ...legacy, version: 2, positions: {}, viewport: DEFAULT_GRAPH_STATE.viewport, legendOpen: true })!;
      }
    }
  } catch { /* A disabled or unreadable store leaves the view usable. */ }
  return { state, saved };
}

export function saveGraphState(storage: Pick<Storage, "getItem" | "setItem">, state: GraphState): void {
  try {
    const text = storage.getItem(GRAPH_STORAGE_KEY);
    if (text !== null && sanitizeGraphState(JSON.parse(text)) === null) return;
    storage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}
