import type { FlockBinding, FlockCommand, FlockRegistry } from "./flock.ts";
import { sameFlockBinding } from "./flock-inventory.ts";

const isJsonObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\u0000");
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const named = (value: unknown): value is string => text(value) && value.trim() === value && value.length <= 200;
function bindingValue(raw: unknown): raw is FlockBinding {
  return isJsonObject(raw) && [raw["machine_id"], raw["herdr_lifetime"], raw["pane_id"], raw["agent"], raw["native_session_id"]].every(text);
}

/** Validate the whole owned format before any write. Unknown versions and broken references stay untouched. */
export function flockRegistryValue(raw: unknown): raw is FlockRegistry {
  if (!isJsonObject(raw) || raw["version"] !== 1 || !Number.isSafeInteger(raw["revision"]) || (raw["revision"] as number) < 0) return false;
  const { works, sessions, checkouts, executions } = raw;
  if (![works, sessions, checkouts, executions].every(Array.isArray)) return false;
  const lists = [works, sessions, checkouts, executions] as Record<string, unknown>[][];
  const allIds = new Set<string>();
  for (const list of lists) for (const item of list) {
    if (!isJsonObject(item) || !text(item["id"]) || allIds.has(item["id"])) return false;
    allIds.add(item["id"]);
  }
  const [ws, ss, cs, es] = lists as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
  if (!ws.every((w) => named(w["name"]))) return false;
  if (!cs.every((c) => text(c["machine_id"]) && text(c["path"]) && nullableText(c["repository"]) && nullableText(c["branch"]))) return false;
  if (!ss.every((s) => named(s["name"]) && (s["work_id"] === null || ws.some((w) => w["id"] === s["work_id"]))
    && (s["current_execution_id"] === null || es.some((e) => e["id"] === s["current_execution_id"] && e["session_id"] === s["id"])))) return false;
  return es.every((e, index) => bindingValue(e) && text(e["created_at"]) && Number.isFinite(Date.parse(e["created_at"]))
    && ss.some((s) => s["id"] === e["session_id"])
    && (e["checkout_id"] === null || cs.some((c) => c["id"] === e["checkout_id"] && c["machine_id"] === e.machine_id))
    && !es.slice(0, index).some((other) => sameFlockBinding(other as unknown as FlockBinding, e)));
}

export function flockCommandValue(raw: unknown): raw is FlockCommand {
  if (!isJsonObject(raw)) return false;
  switch (raw["type"]) {
    case "create-work": return named(raw["name"]);
    case "rename-work": return text(raw["id"]) && named(raw["name"]);
    case "rename-session": return text(raw["id"]) && named(raw["name"]) && nullableText(raw["work_id"]);
    case "adopt": return bindingValue(raw["binding"]) && (raw["session_id"] === undefined ? named(raw["name"]) : text(raw["session_id"]))
      && (raw["work_id"] === undefined || nullableText(raw["work_id"])) && (raw["expected_execution_id"] === undefined || nullableText(raw["expected_execution_id"]));
    default: return false;
  }
}
