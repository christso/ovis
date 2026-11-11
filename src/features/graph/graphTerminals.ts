import { graphBinding, graphCheckout, type GraphRegistryRow } from "../../../shared/graph-registry-inventory.ts";
import { graphCurrentHerdrEndpoint, graphHerdrEndpointKey } from "../../../shared/graph-relationships.ts";
import type { Machine } from "../../../shared/machines.ts";
import { pushPaneTitle } from "../../../shared/notify-policy.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { rollupStatus } from "../../lib/status.ts";
import { graphTabNames } from "./graphNames.ts";
import type { GraphNode } from "./graphModel.ts";

/** Tabs supply names and navigation; every terminal is represented exactly once. */
export function graphTerminals(machines: readonly Machine[], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate, rows: readonly GraphRegistryRow[] = []) {
  return machines.flatMap((machine) => (machine.snapshot?.tabs ?? []).flatMap((tab) => {
    const snapshot = machine.snapshot!;
    const workspace = snapshot.workspaces.find((workspace) => workspace.workspace_id === tab.workspace_id);
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).sort((a, b) => a.pane_id.localeCompare(b.pane_id));
    if (!workspace || !panes.length) return [];
    const names = graphTabNames(machine, tab, labels, t);
    const siblings = snapshot.tabs.filter((other) => other.workspace_id === workspace.workspace_id);
    const linked = workspace.worktree?.is_linked_worktree;
    const tabName = names.custom || names.automatic || names.numbered;
    const label = linked && siblings.length === 1 && !names.custom ? workspace.label
      : linked ? `${workspace.label} · ${tabName}` : tabName;
    return panes.map((pane) => {
      const row = rows.find((row) => row.machine_id === machine.id && row.pane?.pane_id === pane.pane_id && row.pane.terminal_id === pane.terminal_id);
      const binding = row?.binding ?? graphBinding(machine, pane);
      const native = pane.agent_session?.kind === "id" ? pane.agent_session.value : binding?.native_session_id ?? null;
      const endpoint = binding ? null : row?.herdr_endpoint ?? graphCurrentHerdrEndpoint(machine, pane);
      const occupant = [pane.pane_id, pane.terminal_id, pane.agent, native, endpoint ? graphHerdrEndpointKey(endpoint) : null];
      const id = `terminal:${JSON.stringify([machine.id, snapshot.herdr_lifetime ?? null, workspace.workspace_id, tab.tab_id, occupant])}`;
      const available = machine.state === "connected" && !!snapshot.herdr_lifetime && !!pane.terminal_id && !pane.restore_error;
      const checkout = graphCheckout(machine, pane);
      const node: GraphNode = { id, kind: "terminal", label: panes.length === 1 ? label : pushPaneTitle(pane),
        namedTerminal: panes.length === 1 ? !!names.custom || !!linked : !!pane.label, machineId: machine.id,
        status: available ? rollupStatus([pane.agent_status]) : "unknown",
        freshness: available ? "live" : machine.state !== "connected" ? "disconnected" : "unavailable",
        detail: [...new Set([workspace.label, label, pane.pane_id, checkout?.repository, checkout?.branch, checkout?.path, pane.cwd,
          pane.display_agent || pane.agent, pane.agent_session?.kind === "id" ? pane.agent_session.value : null].filter(Boolean))].join("\n") };
      return { node, panes: [pane], machine, workspace };
    });
  }));
}
