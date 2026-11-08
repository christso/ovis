import { flockCheckout } from "../../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { knownStatus } from "../../lib/status.ts";
import { graphTabNames } from "./graphNames.ts";
import type { GraphNode } from "./graphModel.ts";

export function graphTerminalTabs(machines: readonly Machine[], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate) {
  return machines.flatMap((machine) => (machine.snapshot?.tabs ?? []).flatMap((tab) => {
    const snapshot = machine.snapshot!;
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).sort((a, b) => a.pane_id.localeCompare(b.pane_id));
    if (!panes.length || panes.some((pane) => pane.agent)) return [];
    const id = `tab:${JSON.stringify([machine.id, snapshot.herdr_lifetime ?? null, tab.tab_id, panes.map((pane) => [pane.pane_id, pane.terminal_id])])}`;
    const names = graphTabNames(machine, tab, labels, t);
    const live = machine.state === "connected" && !!snapshot.herdr_lifetime && panes.every((pane) => !!pane.terminal_id && !pane.restore_error);
    const node: GraphNode = { id, kind: "tab", label: names.custom || names.automatic || names.numbered, namedTab: !!names.custom, machineId: machine.id, status: live ? knownStatus(tab.agent_status) : "unknown", freshness: live ? "live" : machine.state !== "connected" ? "disconnected" : "unavailable" };
    const target: PaneTarget | null = live ? { machine_id: machine.id, pane_id: panes[0]!.pane_id } : null;
    return [{ node, target, checkouts: panes.flatMap((pane) => { const checkout = flockCheckout(machine, pane); return checkout ? [{ ...checkout, id: `${id}:${pane.pane_id}` }] : []; }) }];
  }));
}
