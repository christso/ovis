import type { FlockObservation, FlockRegistry, FlockStoredObservation } from "./flock.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function flockObservationValue(value: unknown): value is FlockObservation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 512 && !raw.id.includes("\u0000")
    && (raw.kind === "delegation" || raw.kind === "communication") && raw.source === "codex"
    && typeof raw.source_native_session_id === "string" && uuid.test(raw.source_native_session_id)
    && typeof raw.target_native_session_id === "string" && uuid.test(raw.target_native_session_id)
    && raw.source_native_session_id !== raw.target_native_session_id
    && typeof raw.occurred_at === "string" && raw.occurred_at.length <= 64 && Number.isFinite(Date.parse(raw.occurred_at));
}
export interface FlockRelationshipEndpoint { id: string; label: string; machine_id: string; native_session_id: string; session_id: string | null }
export interface FlockRelationship { id: string; kind: FlockObservation["kind"]; source: FlockRelationshipEndpoint; target: FlockRelationshipEndpoint; count: number; first_at: string; last_at: string }

/** Historical execution bindings carry relationships through an explicit session move. */
export function flockRelationshipEndpoint(registry: FlockRegistry, machineId: string, nativeId: string): FlockRelationshipEndpoint {
  const sessions = new Set(registry.executions.filter((execution) => execution.machine_id === machineId && execution.agent === "codex" && execution.native_session_id === nativeId).map((execution) => execution.session_id));
  const session = sessions.size === 1 ? registry.sessions.find((item) => sessions.has(item.id)) : undefined;
  return { id: session ? `session:${session.id}` : `native:${JSON.stringify([machineId, "codex", nativeId])}`, label: session?.name ?? `Codex ${nativeId.slice(0, 8)}`, machine_id: machineId, native_session_id: nativeId, session_id: session?.id ?? null };
}

export function flockRelationships(registry: FlockRegistry): FlockRelationship[] {
  const relations = new Map<string, FlockRelationship>();
  for (const event of registry.observations ?? []) {
    const source = flockRelationshipEndpoint(registry, event.machine_id, event.source_native_session_id);
    const target = flockRelationshipEndpoint(registry, event.machine_id, event.target_native_session_id);
    if (source.id === target.id) continue;
    const id = JSON.stringify([event.kind, source.id, target.id]);
    const before = relations.get(id);
    if (before) {
      before.count += 1;
      if (Date.parse(event.occurred_at) < Date.parse(before.first_at)) before.first_at = event.occurred_at;
      if (Date.parse(event.occurred_at) > Date.parse(before.last_at)) before.last_at = event.occurred_at;
    } else relations.set(id, { id, kind: event.kind, source, target, count: 1, first_at: event.occurred_at, last_at: event.occurred_at });
  }
  return [...relations.values()];
}

export function flockObservationKey(event: FlockStoredObservation): string {
  return JSON.stringify([event.machine_id, event.source, event.source_native_session_id, event.id, event.kind, event.target_native_session_id]);
}
