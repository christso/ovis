import { flockBinding, flockCheckout, type FlockRow } from "../../../shared/flock-inventory.ts";
import { flockCurrentHerdrEndpoint, flockHerdrEndpointKey } from "../../../shared/flock-relationships.ts";
import type { Machine } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { rollupStatus } from "../../lib/status.ts";
import { worktreeGroups } from "../../lib/workspaceOrder.ts";
import { graphTabNames } from "./graphNames.ts";
import type { GraphGroup, GraphNode } from "./graphModel.ts";

export function graphTabs(machines: readonly Machine[], labels: Readonly<Record<string, string>> = {}, t: Translate = defaultTranslate, rows: readonly FlockRow[] = []) {
  return machines.flatMap((machine) => (machine.snapshot?.tabs ?? []).flatMap((tab) => {
    const snapshot = machine.snapshot!;
    const workspace = snapshot.workspaces.find((workspace) => workspace.workspace_id === tab.workspace_id);
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).sort((a, b) => a.pane_id.localeCompare(b.pane_id));
    if (!workspace || !panes.length) return [];
    const occupants = panes.map((pane) => {
      const row = rows.find((row) => row.machine_id === machine.id && row.pane?.pane_id === pane.pane_id && row.pane.terminal_id === pane.terminal_id);
      const binding = row?.binding ?? flockBinding(machine, pane);
      // Reported native identity distinguishes occupants, but only flockTarget authorizes opening one.
      const native = pane.agent_session?.kind === "id" ? pane.agent_session.value : binding?.native_session_id ?? null;
      const endpoint = binding ? null : row?.herdr_endpoint ?? flockCurrentHerdrEndpoint(machine, pane);
      return [pane.pane_id, pane.terminal_id, pane.agent, native, endpoint ? flockHerdrEndpointKey(endpoint) : null];
    });
    const id = `tab:${JSON.stringify([machine.id, snapshot.herdr_lifetime ?? null, workspace.workspace_id, tab.tab_id, occupants])}`;
    const names = graphTabNames(machine, tab, labels, t);
    const siblings = snapshot.tabs.filter((other) => other.workspace_id === workspace.workspace_id);
    const linked = workspace.worktree?.is_linked_worktree;
    const tabName = names.custom || names.automatic || names.numbered;
    const label = linked && siblings.length === 1 && !names.custom ? workspace.label
      : linked ? `${workspace.label} · ${tabName}` : tabName;
    const available = machine.state === "connected" && !!snapshot.herdr_lifetime && panes.every((pane) => !!pane.terminal_id && !pane.restore_error);
    const checkouts = panes.flatMap((pane) => { const checkout = flockCheckout(machine, pane); return checkout ? [checkout] : []; });
    const repositories = [...new Set(checkouts.flatMap((checkout) => checkout.repository ? [checkout.repository] : []))];
    const repository = repositories.length === 1 ? repositories[0]! : null;
    const repositoryName = repository ? workspace.worktree?.repo_name || repository.split(/[\\/]/).filter(Boolean).at(-1) || repository : undefined;
    const node: GraphNode = { id, kind: "tab", label, namedTab: !!names.custom || !!linked, machineId: machine.id,
      status: available ? rollupStatus(panes.map((pane) => pane.agent_status)) : "unknown",
      freshness: available ? "live" : machine.state !== "connected" ? "disconnected" : "unavailable",
      repositoryKey: repository ? workspace.worktree?.repo_name || repository : undefined, repositoryName,
      detail: [...new Set([workspace.label, ...checkouts.flatMap((checkout) => [checkout.repository, checkout.branch, checkout.path]), ...panes.flatMap((pane) => [pane.display_agent || pane.agent, pane.agent_session?.kind === "id" ? pane.agent_session.value : null])].filter(Boolean))].join("\n") };
    return [{ node, panes, machine, workspace }];
  }));
}

export function graphWorkspaceGroups(machines: readonly Machine[], tabs: ReturnType<typeof graphTabs>): GraphGroup[] {
  return machines.flatMap((machine) => worktreeGroups(machine.snapshot?.workspaces ?? []).flatMap(({ workspace, children }) => [workspace, ...children].map((member) => {
    const members = new Set(member === workspace ? [workspace.workspace_id, ...children.map((child) => child.workspace_id)] : [member.workspace_id]);
    return { id: `workspace:${JSON.stringify([machine.id, member.workspace_id])}`, label: member.label, machineId: machine.id,
      nodeIds: tabs.filter((tab) => tab.machine.id === machine.id && members.has(tab.workspace.workspace_id)).map((tab) => tab.node.id) };
  })));
}
