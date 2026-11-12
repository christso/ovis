import { GRAPH_KINDS, GRAPH_STATUSES } from "./graphLabels.ts";
import { DEFAULT_HIDDEN_KINDS, type GraphFilters, type GraphKind } from "./graphModel.ts";
import type { Positions, Viewport } from "./graphLayout.ts";

export interface GraphState {
  version: 4;
  layout?: "force";
  selected: string;
  filters: GraphFilters;
  groupMachine: boolean;
  legendOpen: boolean;
  positions: Positions;
  viewport: Viewport;
}
export const GRAPH_STORAGE_KEY = "ovis:graph:v4";
export const DEFAULT_GRAPH_STATE: GraphState = {
  version: 4, layout: "force", selected: "", filters: { search: "", status: "", machine: "", focus: "", showCompleted: false, communication: "recent", hiddenKinds: DEFAULT_HIDDEN_KINDS },
  groupMachine: false, legendOpen: true, positions: {}, viewport: { x: 160, y: 100, k: 1 },
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, limit = 1000) => typeof value === "string" ? value.slice(0, limit) : "";
const finite = (value: unknown, fallback: number, max = 1e6) => typeof value === "number" && Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : fallback;
const hiddenKinds = (value: unknown): GraphKind[] => GRAPH_KINDS.filter((kind) => Array.isArray(value) && value.includes(kind));
const currentId = (value: unknown) => typeof value === "string" && /^(tab|pane):/.test(value) ? "" : value;
function legacyKinds(value: unknown): GraphKind[] {
  return hiddenKinds(Array.isArray(value) ? value.map((kind) => kind === "tab" ? "terminal" : kind) : []);
}

/** A new isolated key; future versions are refused by readers and writers, never overwritten. */
export function sanitizeGraphState(raw: unknown): GraphState | null {
  const value = record(raw);
  if (value.version !== 4 || (value.layout !== undefined && value.layout !== "force")) return null;
  for (const key of ["filters", "positions", "viewport"]) {
    const field = value[key];
    if (field !== undefined && (!field || typeof field !== "object" || Array.isArray(field))) return null;
  }
  const filters = record(value.filters), viewport = record(value.viewport);
  if (filters.hiddenKinds !== undefined && !Array.isArray(filters.hiddenKinds)) return null;
  const positions: Positions = Object.create(null);
  for (const [id, rawPoint] of Object.entries(record(value.positions)).slice(0, 10000)) {
    const point = record(rawPoint);
    if (typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y)) {
      positions[id] = { x: finite(point.x, 0), y: finite(point.y, 0) };
    }
  }
  return {
    version: 4, layout: "force", selected: str(typeof value.selected === "string" && /^(workspace|worktree):/.test(value.selected) ? "" : currentId(value.selected), 64_000), groupMachine: value.groupMachine === true, legendOpen: typeof value.legendOpen === "boolean" ? value.legendOpen : true, positions,
    filters: { search: str(filters.search), machine: str(filters.machine), focus: str(currentId(filters.focus), 64_000), status: GRAPH_STATUSES.some((status) => status === str(filters.status)) ? str(filters.status) : "", showCompleted: filters.showCompleted === true, communication: filters.communication === "all" || filters.communication === "none" ? filters.communication : "recent", hiddenKinds: hiddenKinds(filters.hiddenKinds) },
    viewport: { x: finite(viewport.x, 160), y: finite(viewport.y, 100), k: Math.max(0.08, finite(viewport.k, 1, 4)) },
  };
}

/** Only graph-owned query fields change; normal Ovis selection and view location stay owned by App. */
export function graphLocation(url: URL, state: GraphState): URL {
  const next = new URL(url);
  for (const [key, value] of Object.entries({ gn: state.selected, gq: state.filters.search, gs: state.filters.status, gm: state.filters.machine, gf: state.filters.focus, gc: state.filters.showCompleted ? "1" : "", gg: state.groupMachine ? "1" : "", gcomm: state.filters.communication === "all" || state.filters.communication === "none" ? state.filters.communication : "", gk: hiddenKinds(state.filters.hiddenKinds).join(",") })) {
    if (value) next.searchParams.set(key, value); else next.searchParams.delete(key);
  }
  next.searchParams.delete("gp");
  next.searchParams.set("graph", "1");
  return next;
}
export function readGraphLocation(url: URL, fallback: GraphState): GraphState {
  if (url.searchParams.get("graph") !== "1") return fallback;
  const p = url.searchParams;
  const state = sanitizeGraphState({ ...fallback, selected: p.get("gn"), groupMachine: p.get("gg") === "1", filters: { search: p.get("gq"), status: p.get("gs"), machine: p.get("gm"), focus: p.get("gf"), showCompleted: p.get("gc") === "1", communication: p.get("gcomm") } })!;
  const kinds = legacyKinds(p.get("gk")?.split(","));
  return { ...state, filters: { ...state.filters, hiddenKinds: kinds } };
}

/** Older pages keep their stores. Derive compatible filters, resetting topology coordinates once. */
export function loadGraphState(storage: Pick<Storage, "getItem">): { state: GraphState; saved: boolean } {
  let state = DEFAULT_GRAPH_STATE, saved = false, migrateKinds = false;
  try {
    const text = storage.getItem(GRAPH_STORAGE_KEY);
    if (text !== null) {
      const stored = sanitizeGraphState(JSON.parse(text));
      if (stored) {
        state = stored;
        saved = Object.keys(stored.positions).length > 0 || stored.viewport.x !== DEFAULT_GRAPH_STATE.viewport.x || stored.viewport.y !== DEFAULT_GRAPH_STATE.viewport.y || stored.viewport.k !== DEFAULT_GRAPH_STATE.viewport.k;
      }
    } else {
      migrateKinds = true;
      const v3 = storage.getItem("ovis:graph:v3"), v2 = storage.getItem("ovis:graph:v2");
      const legacy = record(JSON.parse(v3 ?? v2 ?? storage.getItem("ovis:graph:v1") ?? "null"));
      if (legacy.version === (v3 !== null ? 3 : v2 !== null ? 2 : 1) && (legacy.layout === undefined || legacy.layout === "force")) {
        state = sanitizeGraphState({ ...legacy, version: 4, positions: {}, viewport: DEFAULT_GRAPH_STATE.viewport })!;
        migrateKinds = v3 === null;
      }
    }
  } catch { /* A disabled or unreadable store leaves the view usable. */ }
  if (migrateKinds) {
    try {
      const kinds = record(JSON.parse(storage.getItem("ovis:graph:kinds:v1") ?? "null"));
      if (kinds.version === 1 && Array.isArray(kinds.hiddenKinds)) state = { ...state, filters: { ...state.filters, hiddenKinds: legacyKinds(kinds.hiddenKinds) } };
    } catch {}
  }
  return { state, saved };
}

export function saveGraphState(storage: Pick<Storage, "getItem" | "setItem">, state: GraphState): void {
  try {
    const text = storage.getItem(GRAPH_STORAGE_KEY);
    if (text !== null && sanitizeGraphState(JSON.parse(text)) === null) return;
    storage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}
