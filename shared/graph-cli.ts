import type { GraphCliObservation, GraphCliPage, GraphCliTerminal } from "./graph-registry.ts";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\u0000");
export function graphCliTerminalValue(value: unknown): value is GraphCliTerminal {
  return object(value) && [value.server_id, value.boot_id, value.terminal_id, value.pane_id].every((item) => text(item))
    && (value.agent === null || text(value.agent)) && (value.name === null || text(value.name, 200));
}
export function graphCliTerminalKey(endpoint: Pick<GraphCliTerminal, "server_id" | "boot_id" | "terminal_id">): string {
  return JSON.stringify([endpoint.server_id, endpoint.boot_id, endpoint.terminal_id]);
}
export function graphCliObservationValue(value: unknown): value is GraphCliObservation {
  return object(value) && text(value.id) && value.producer === "herdr-cli" && value.scope === "terminal"
    && (value.kind === "delegation" || value.kind === "communication") && text(value.occurred_at, 64) && Number.isFinite(Date.parse(value.occurred_at))
    && graphCliTerminalValue(value.source_terminal) && graphCliTerminalValue(value.target_terminal)
    && graphCliTerminalKey(value.source_terminal) !== graphCliTerminalKey(value.target_terminal);
}
export function graphCliPageValue(value: unknown): value is GraphCliPage {
  return object(value) && value.version === 1 && text(value.server_id) && text(value.boot_id) && Array.isArray(value.receipts)
    && (value.current_agents === undefined || (Array.isArray(value.current_agents) && value.current_agents.every((agent) => graphCliTerminalValue(agent)
      && agent.server_id === value.server_id && agent.boot_id === value.boot_id && agent.agent !== null && object(agent) && text(agent.agent_instance_id))
      && new Set(value.current_agents.map((agent) => JSON.stringify([agent.terminal_id, agent.agent_instance_id]))).size === value.current_agents.length))
    && value.receipts.every((receipt) => graphCliObservationValue(receipt) && receipt.source_terminal.server_id === value.server_id);
}
export function graphCliObservationKey(event: GraphCliObservation): string {
  return JSON.stringify([event.producer, event.source_terminal.server_id, event.id]);
}
export function graphCliTerminalMetadata(endpoint: GraphCliTerminal): GraphCliTerminal {
  return { server_id: endpoint.server_id, boot_id: endpoint.boot_id, terminal_id: endpoint.terminal_id, pane_id: endpoint.pane_id, agent: endpoint.agent, name: endpoint.name };
}
export function graphCliObservationMetadata(event: GraphCliObservation): GraphCliObservation {
  return { id: event.id, kind: event.kind, producer: "herdr-cli", scope: "terminal", source_terminal: graphCliTerminalMetadata(event.source_terminal), target_terminal: graphCliTerminalMetadata(event.target_terminal), occurred_at: event.occurred_at };
}
