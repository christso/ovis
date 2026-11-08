import type { FlockObservation, FlockRegistry, FlockStoredObservation, HerdrCoordinationEndpoint, HerdrCoordinationPage } from "./flock.ts";
import type { FlockRow } from "./flock-inventory.ts";
import type { Machine, PaneTarget } from "./machines.ts";
import type { HerdrPane } from "./protocol.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\u0000");
const time = (value: unknown): value is string => text(value, 64) && Number.isFinite(Date.parse(value));
const kind = (value: unknown): value is FlockObservation["kind"] => value === "delegation" || value === "communication";

/** Custom agent labels mirror Herdr's display metadata; runtime identity fields stay bounded. */
export function flockHerdrEndpointValue(value: unknown): value is HerdrCoordinationEndpoint {
  return object(value) && [value.server_id, value.boot_id, value.terminal_id, value.agent_instance_id, value.pane_id].every((item) => text(item))
    && typeof value.agent === "string" && value.agent.trim().length > 0 && (value.name === null || text(value.name, 200));
}
export function flockHerdrEndpointMetadata(endpoint: HerdrCoordinationEndpoint): HerdrCoordinationEndpoint {
  return { server_id: endpoint.server_id, boot_id: endpoint.boot_id, terminal_id: endpoint.terminal_id, agent_instance_id: endpoint.agent_instance_id,
    agent: endpoint.agent, pane_id: endpoint.pane_id, name: endpoint.name };
}
/** Names and pane movement do not change an occupancy's identity. */
export function flockHerdrEndpointKey(endpoint: HerdrCoordinationEndpoint): string {
  return JSON.stringify([endpoint.server_id, endpoint.boot_id, endpoint.terminal_id, endpoint.agent_instance_id]);
}
export function flockCoordinationValue(value: unknown): value is HerdrCoordinationPage {
  if (!object(value) || value.version !== 1 || !text(value.server_id) || !text(value.boot_id)
    || !Array.isArray(value.agents) || !Array.isArray(value.receipts)
    || !(value.cursor === null || text(value.cursor))) return false;
  const identities = new Set<string>();
  for (const agent of value.agents) {
    if (!flockHerdrEndpointValue(agent) || agent.server_id !== value.server_id || agent.boot_id !== value.boot_id) return false;
    const key = flockHerdrEndpointKey(agent);
    if (identities.has(key)) return false;
    identities.add(key);
  }
  return value.receipts.every((receipt) => object(receipt) && text(receipt.id) && kind(receipt.kind) && time(receipt.occurred_at)
    && flockHerdrEndpointValue(receipt.source) && flockHerdrEndpointValue(receipt.target) && receipt.source.server_id === value.server_id
    && flockHerdrEndpointKey(receipt.source) !== flockHerdrEndpointKey(receipt.target));
}
export function flockCoordinationPageValue(value: unknown): value is HerdrCoordinationPage {
  return flockCoordinationValue(value) && value.receipts.length <= 500;
}
export function flockObservationValue(value: unknown): value is FlockObservation {
  if (!object(value) || !text(value.id) || !kind(value.kind) || !time(value.occurred_at)) return false;
  if (value.source === "herdr") return flockHerdrEndpointValue(value.source_endpoint) && flockHerdrEndpointValue(value.target_endpoint)
    && flockHerdrEndpointKey(value.source_endpoint) !== flockHerdrEndpointKey(value.target_endpoint);
  return value.source === "codex" && typeof value.source_native_session_id === "string" && uuid.test(value.source_native_session_id)
    && typeof value.target_native_session_id === "string" && uuid.test(value.target_native_session_id)
    && value.source_native_session_id.toLowerCase() !== value.target_native_session_id.toLowerCase();
}
export interface FlockRelationshipEndpoint { id: string; label: string; machine_id: string; agent: string; native_session_id: string; session_id: string | null; herdr?: HerdrCoordinationEndpoint }
export interface FlockRelationship { id: string; kind: FlockObservation["kind"]; source: FlockRelationshipEndpoint; target: FlockRelationshipEndpoint; count: number; first_at: string; last_at: string; sources: ("codex" | "herdr")[] }

/** Historical execution bindings carry relationships through an explicit session move. */
export function flockRelationshipEndpoint(registry: FlockRegistry, machineId: string, nativeId: string, agent = "codex"): FlockRelationshipEndpoint {
  const sessions = new Set(registry.executions.filter((execution) => execution.machine_id === machineId && execution.agent === agent && execution.native_session_id.toLowerCase() === nativeId.toLowerCase()).map((execution) => execution.session_id));
  const session = sessions.size === 1 ? registry.sessions.find((item) => sessions.has(item.id)) : undefined;
  return { id: session ? `session:${session.id}` : `native:${JSON.stringify([machineId, agent, nativeId.toLowerCase()])}`, label: session?.name ?? `${agent === "codex" ? "Codex" : agent} ${nativeId.slice(0, 8)}`, machine_id: machineId, agent, native_session_id: nativeId, session_id: session?.id ?? null };
}

export function flockHerdrRelationshipEndpoint(registry: FlockRegistry, endpoint: HerdrCoordinationEndpoint): FlockRelationshipEndpoint {
  const matches = (registry.herdr_associations ?? []).filter((association) => flockHerdrEndpointKey(association.endpoint) === flockHerdrEndpointKey(endpoint));
  const native = new Map(matches.filter((item) => item.native_session_id !== null).map((item) => [JSON.stringify([item.machine_id, item.endpoint.agent, item.native_session_id!.toLowerCase()]), item]));
  if (native.size === 1) {
    const association = [...native.values()][0]!;
    return { ...flockRelationshipEndpoint(registry, association.machine_id, association.native_session_id!, association.endpoint.agent), herdr: endpoint };
  }
  const machines = new Set(matches.map((item) => item.machine_id));
  return { id: `herdr:${flockHerdrEndpointKey(endpoint)}`, label: endpoint.name ?? `${endpoint.agent} ${endpoint.agent_instance_id.slice(0, 8)}`,
    machine_id: machines.size === 1 ? [...machines][0]! : "", agent: endpoint.agent, native_session_id: "", session_id: null, herdr: endpoint };
}

/** Current daemon occupancy is a location proof, never proof of a native transcript/session. */
export function flockCurrentHerdrEndpoint(machine: Machine, pane: HerdrPane): HerdrCoordinationEndpoint | null {
  const snapshot = machine.snapshot, coordination = snapshot?.flock_coordination;
  if (machine.state !== "connected" || !snapshot?.herdr_lifetime || !coordination || coordination.version !== 1 || !Array.isArray(coordination.agents) || pane.restore_error) return null;
  const matches = coordination.agents.filter((endpoint) => flockHerdrEndpointValue(endpoint) && endpoint.server_id === coordination.server_id && endpoint.boot_id === coordination.boot_id
    && endpoint.pane_id === pane.pane_id && endpoint.terminal_id === pane.terminal_id && endpoint.agent === pane.agent);
  return matches.length === 1 ? matches[0]! : null;
}

/** Opening a current terminal needs exact daemon occupancy; native adoption has its separate proof. */
export function flockHerdrTarget(endpoint: HerdrCoordinationEndpoint, machines: readonly Machine[]): PaneTarget | null {
  const matches: PaneTarget[] = [];
  for (const machine of machines) for (const pane of machine.snapshot?.panes ?? []) {
    const current = flockCurrentHerdrEndpoint(machine, pane);
    if (current && flockHerdrEndpointKey(current) === flockHerdrEndpointKey(endpoint)) matches.push({ machine_id: machine.id, pane_id: pane.pane_id });
  }
  return matches.length === 1 ? matches[0]! : null;
}

export function flockRowRelationshipIds(registry: FlockRegistry, row: FlockRow, machines: readonly Machine[] = []): string[] {
  const ids = new Set<string>();
  if (row.session) ids.add(`session:${row.session.id}`);
  const native = row.execution ?? row.binding;
  if (native) ids.add(flockRelationshipEndpoint(registry, row.machine_id, native.native_session_id, native.agent).id);
  const machine = machines.find((item) => item.id === row.machine_id);
  const endpoint = row.herdr_endpoint ?? (machine && row.pane ? flockCurrentHerdrEndpoint(machine, row.pane) : null);
  if (endpoint) ids.add(flockHerdrRelationshipEndpoint(registry, endpoint).id);
  return [...ids];
}

export function flockRelationships(registry: FlockRegistry): FlockRelationship[] {
  const relations = new Map<string, FlockRelationship>();
  const receipts = new Set<string>();
  const endpoints = new Map<string, FlockRelationshipEndpoint>();
  const endpoint = (machine: string, native: string) => {
    const key = JSON.stringify([machine, native]);
    let value = endpoints.get(key);
    if (!value) { value = flockRelationshipEndpoint(registry, machine, native); endpoints.set(key, value); }
    return value;
  };
  const herdrEndpoint = (value: HerdrCoordinationEndpoint) => {
    const key = JSON.stringify(["herdr", flockHerdrEndpointKey(value), value.agent, value.name, value.pane_id]);
    let resolved = endpoints.get(key);
    if (!resolved) { resolved = flockHerdrRelationshipEndpoint(registry, value); endpoints.set(key, resolved); }
    return resolved;
  };
  for (const event of registry.observations ?? []) {
    const receipt = flockReceiptKey(event);
    if (receipts.has(receipt)) continue;
    receipts.add(receipt);
    const source = event.source === "herdr" ? herdrEndpoint(event.source_endpoint) : endpoint(event.machine_id, event.source_native_session_id);
    const target = event.source === "herdr" ? herdrEndpoint(event.target_endpoint) : endpoint(event.machine_id, event.target_native_session_id);
    if (source.id === target.id) continue;
    const id = JSON.stringify([event.kind, source.id, target.id]);
    const before = relations.get(id);
    if (before) {
      before.count += 1;
      if (!before.sources.includes(event.source)) before.sources.push(event.source);
      if (Date.parse(event.occurred_at) < Date.parse(before.first_at)) before.first_at = event.occurred_at;
      if (Date.parse(event.occurred_at) > Date.parse(before.last_at)) before.last_at = event.occurred_at;
    } else relations.set(id, { id, kind: event.kind, source, target, count: 1, first_at: event.occurred_at, last_at: event.occurred_at, sources: [event.source] });
  }
  return [...relations.values()];
}

export function flockObservationKey(event: FlockStoredObservation): string {
  return JSON.stringify([event.machine_id, flockReceiptKey(event)]);
}

/** Copied native rollouts and repeated daemon reads retain the original receipt identity. */
export function flockReceiptKey(event: FlockObservation): string {
  if (event.source === "herdr") return JSON.stringify(["herdr", event.source_endpoint.server_id, event.id]);
  return JSON.stringify([event.source, event.source_native_session_id.toLowerCase(), event.id, event.kind, event.target_native_session_id.toLowerCase()]);
}
