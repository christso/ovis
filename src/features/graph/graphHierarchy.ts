import type { Machine } from "../../../shared/machines.ts";
import { rollupStatus } from "../../lib/status.ts";
import { worktreeGroups } from "../../lib/workspaceOrder.ts";
import type { GraphEdge, GraphGroup, GraphNode } from "./graphModel.ts";
import type { graphTabs } from "./graphTabs.ts";

type Tab = ReturnType<typeof graphTabs>[number];
interface Hub { node: GraphNode; tabs: Tab[] }

export function graphHierarchy(machines: readonly Machine[], tabs: readonly Tab[]) {
  const hubs: Hub[] = [], edges: GraphEdge[] = [], groups: GraphGroup[] = [];
  const tabsByWorkspace = new Map<string, Tab[]>();
  for (const tab of tabs) {
    const key = JSON.stringify([tab.machine.id, tab.workspace.workspace_id]);
    const members = tabsByWorkspace.get(key) ?? [];
    members.push(tab); tabsByWorkspace.set(key, members);
  }
  for (const machine of machines) {
    const snapshot = machine.snapshot;
    if (!snapshot) continue;
    const native = new Map<string, Hub>();
    const panesByWorkspace = new Map<string, typeof snapshot.panes>();
    for (const pane of snapshot.panes) {
      const members = panesByWorkspace.get(pane.workspace_id) ?? [];
      members.push(pane); panesByWorkspace.set(pane.workspace_id, members);
    }
    for (const workspace of snapshot.workspaces) {
      const members = tabsByWorkspace.get(JSON.stringify([machine.id, workspace.workspace_id])) ?? [];
      const terminals = (panesByWorkspace.get(workspace.workspace_id) ?? []).map((pane) => [pane.pane_id, pane.terminal_id ?? null] as const).sort(([a], [b]) => a.localeCompare(b));
      const kind = workspace.worktree?.is_linked_worktree ? "worktree" : "workspace";
      const live = machine.state === "connected" && !!snapshot.herdr_lifetime;
      const paths = members.flatMap((tab) => tab.panes.map((pane) => pane.cwd));
      const node: GraphNode = { id: `${kind}:${JSON.stringify([machine.id, snapshot.herdr_lifetime ?? null, workspace.workspace_id, terminals])}`, kind,
        label: workspace.label, machineId: machine.id,
        status: live ? members.length ? rollupStatus(members.map((tab) => tab.node.status ?? "unknown")) : "idle" : "unknown",
        freshness: live ? "live" : machine.state !== "connected" ? "disconnected" : "unavailable",
        detail: [...new Set([workspace.worktree?.repo_root, workspace.worktree?.checkout_path, workspace.tokens?.["branch"], ...paths].filter((value): value is string => typeof value === "string" && !!value))].join("\n") };
      const hub = { node, tabs: members }; native.set(workspace.workspace_id, hub); hubs.push(hub);
      for (const tab of members) edges.push({ id: `parent:${tab.node.id}`, source: tab.node.id, target: node.id, kind: kind === "worktree" ? "tab-in-worktree" : "tab-in-workspace", evidence: "Herdr" });
    }
    for (const { workspace, children } of worktreeGroups(snapshot.workspaces)) {
      const root = native.get(workspace.workspace_id)!;
      for (const child of children) {
        const branch = native.get(child.workspace_id)!;
        edges.push({ id: `parent:${branch.node.id}`, source: branch.node.id, target: root.node.id, kind: "worktree-in-workspace", evidence: "Herdr" });
      }
      for (const member of [workspace, ...children]) {
        const members = member === workspace ? [workspace, ...children] : [member];
        groups.push({ id: `workspace:${JSON.stringify([machine.id, member.workspace_id])}`, label: member.label, machineId: machine.id,
          nodeIds: members.flatMap((item) => { const hub = native.get(item.workspace_id)!; return [hub.node.id, ...hub.tabs.map((tab) => tab.node.id)]; }) });
      }
    }
  }
  return { hubs, nodes: hubs.map((hub) => hub.node), edges, groups };
}
