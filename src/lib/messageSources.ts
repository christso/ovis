import type { HerdrCoordinationEndpoint } from "../../shared/graph-registry.ts";
import type { Machine, PaneTarget } from "../../shared/machines.ts";
import { graphHerdrEndpointValue } from "../../shared/graph-relationships.ts";
import { MESSAGE_SOURCE_ID } from "../../shared/message-source.ts";
import { fetchMessageSource, resolveMessageSource } from "./api.ts";

/** Names, pane numbers and cached Graph associations cannot establish a source's machine. */
export async function findMessageSource(id: string, receiver: string, machines: readonly Machine[]): Promise<(PaneTarget & { source: HerdrCoordinationEndpoint }) | null> {
  if (!MESSAGE_SOURCE_ID.test(id) || !machines.some((machine) => machine.id === receiver && machine.enabled && machine.state === "connected")) return null;
  const { sender } = await fetchMessageSource(id, receiver);
  if (!sender || sender.id !== id || !graphHerdrEndpointValue(sender.source)) return null;
  const candidates = await Promise.all(machines.filter((machine) => machine.enabled && machine.state === "connected").map(async (machine) => {
    try {
      const result = await resolveMessageSource(sender.source, machine.id);
      return typeof result.pane_id === "string" && result.pane_id ? { machine_id: machine.id, pane_id: result.pane_id } : null;
    } catch { return null; }
  }));
  const targets = candidates.filter((target) => target !== null);
  return targets.length === 1 ? { ...targets[0]!, source: sender.source } : null;
}

/** Retargeting a saved PC while a lookup runs invalidates the result. */
export const messageSourceMachineKey = (machine: Machine): string => JSON.stringify([machine.id, machine.kind, machine.target, machine.relay, machine.server_id, machine.source_boot_id]);
