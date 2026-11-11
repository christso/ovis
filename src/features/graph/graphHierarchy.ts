import type { Machine } from "../../../shared/machines.ts";
import { rollupStatus } from "../../lib/status.ts";
import { worktreeGroups } from "../../lib/workspaceOrder.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import type { GraphEdge, GraphGroup, GraphNode } from "./graphModel.ts";
import type { graphTerminals } from "./graphTerminals.ts";

type Terminal = ReturnType<typeof graphTerminals>[number];
interface Hub { node: GraphNode; terminals: Terminal[] }

export function graphHierarchy(machines: readonly Machine[], terminals: readonly Terminal[], t: Translate = defaultTranslate) {
  const hubs: Hub[] = [], edges: GraphEdge[] = [], groups: GraphGroup[] = [];
  const terminalsByWorkspace = new Map<string, Terminal[]>();
  for (const terminal of terminals) {
    const key = JSON.stringify([terminal.machine.id, terminal.workspace.workspace_id]);
    const members = terminalsByWorkspace.get(key) ?? [];
    members.push(terminal); terminalsByWorkspace.set(key, members);
  }
  for (const machine of machines) {
    const snapshot = machine.snapshot;
    if (!snapshot) continue;
    const native = new Map<string, Hub>();
    const mainCheckouts = new Map<string, Hub>();
    const panesByWorkspace = new Map<string, typeof snapshot.panes>();
    for (const pane of snapshot.panes) {
      const members = panesByWorkspace.get(pane.workspace_id) ?? [];
      members.push(pane); panesByWorkspace.set(pane.workspace_id, members);
    }
    for (const workspace of snapshot.workspaces) {
      const members = terminalsByWorkspace.get(JSON.stringify([machine.id, workspace.workspace_id])) ?? [];
      const occupants = (panesByWorkspace.get(workspace.workspace_id) ?? []).map((pane) => [pane.pane_id, pane.terminal_id ?? null] as const).sort(([a], [b]) => a.localeCompare(b));
      const kind = workspace.worktree?.is_linked_worktree ? "worktree" : "workspace";
      const live = machine.state === "connected" && !!snapshot.herdr_lifetime;
      const paths = members.flatMap((terminal) => terminal.panes.map((pane) => pane.cwd));
      const node: GraphNode = { id: `${kind}:${JSON.stringify([machine.id, snapshot.herdr_lifetime ?? null, workspace.workspace_id, occupants])}`, kind,
        label: workspace.label, machineId: machine.id,
        status: live ? members.length ? rollupStatus(members.map((terminal) => terminal.node.status ?? "unknown")) : "idle" : "unknown",
        hasWorkingTerminals: live && members.some((terminal) => terminal.node.status === "working" && terminal.node.freshness === "live"),
        freshness: live ? "live" : machine.state !== "connected" ? "disconnected" : "unavailable",
        detail: [...new Set([workspace.worktree?.repo_root, workspace.worktree?.checkout_path, workspace.tokens?.["branch"], ...paths].filter((value): value is string => typeof value === "string" && !!value))].join("\n") };
      const hub = { node, terminals: members }; native.set(workspace.workspace_id, hub); hubs.push(hub);
      let container = node;
      const checkout = workspace.worktree;
      if (checkout && !checkout.is_linked_worktree && checkout.repo_key && checkout.checkout_path) {
        container = { ...node, id: `worktree:${JSON.stringify(["main-checkout", machine.id, snapshot.herdr_lifetime ?? null, workspace.workspace_id, checkout.repo_key, checkout.checkout_path, occupants, members.map((terminal) => terminal.node.id).sort()])}`, kind: "worktree", label: t("Main checkout"), detail: [workspace.label, node.detail].filter(Boolean).join("\n") };
        const main = { node: container, terminals: members };
        mainCheckouts.set(workspace.workspace_id, main); hubs.push(main);
        edges.push({ id: `parent:${container.id}`, source: container.id, target: node.id, kind: "worktree-in-workspace", evidence: "Herdr" });
      }
      for (const terminal of members) edges.push({ id: `parent:${terminal.node.id}`, source: terminal.node.id, target: container.id, kind: container.kind === "worktree" ? "terminal-in-worktree" : "terminal-in-workspace", evidence: "Herdr" });
    }
    for (const { workspace, children } of worktreeGroups(snapshot.workspaces)) {
      const root = native.get(workspace.workspace_id)!;
      for (const child of children) {
        const branch = native.get(child.workspace_id)!;
        root.node.hasWorkingTerminals ||= branch.node.hasWorkingTerminals;
        edges.push({ id: `parent:${branch.node.id}`, source: branch.node.id, target: root.node.id, kind: "worktree-in-workspace", evidence: "Herdr" });
      }
      if (root.node.hasWorkingTerminals) root.node.status = rollupStatus([root.node.status, "working"]);
      for (const member of [workspace, ...children]) {
        const members = member === workspace ? [workspace, ...children] : [member];
        groups.push({ id: `workspace:${JSON.stringify([machine.id, member.workspace_id])}`, label: member.label, machineId: machine.id,
          nodeIds: members.flatMap((item) => { const hub = native.get(item.workspace_id)!, main = mainCheckouts.get(item.workspace_id); return [hub.node.id, ...(main ? [main.node.id] : []), ...hub.terminals.map((terminal) => terminal.node.id)]; }) });
      }
    }
  }
  return { hubs, nodes: hubs.map((hub) => hub.node), edges, groups };
}
