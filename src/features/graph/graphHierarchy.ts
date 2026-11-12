import { graphRepositoryValue } from "../../../shared/graph-repository.ts";
import type { Machine } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { worktreeGroups } from "../../lib/workspaceOrder.ts";
import type { GraphEdge, GraphGroup, GraphNode } from "./graphModel.ts";
import type { graphTerminals } from "./graphTerminals.ts";

type Terminal = ReturnType<typeof graphTerminals>[number];

/** Repository identity is physical evidence, never a workspace name or a navigation authority. */
export function graphHierarchy(machines: readonly Machine[], terminals: readonly Terminal[], t: Translate = defaultTranslate) {
  const hubs = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [], groups: GraphGroup[] = [];
  for (const terminal of terminals) {
    const { machine, workspace } = terminal, pane = terminal.panes[0]!;
    const evidence = machine.snapshot?.graph_repositories;
    const proofs = machine.snapshot?.herdr_lifetime && Array.isArray(evidence) ? evidence.filter((item) => graphRepositoryValue(item) && item.pane_id === pane.pane_id && item.terminal_id === pane.terminal_id && item.cwd === pane.cwd && !pane.restore_error) : [];
    const proof = proofs.length === 1 ? proofs[0] : undefined;
    const remote = proof?.remote;
    const checkout = workspace.worktree?.checkout_path;
    const inCheckout = !!checkout && !!pane.cwd && (pane.cwd === checkout || pane.cwd.startsWith(`${checkout.replace(/[\\/]$/, "")}/`) || pane.cwd.startsWith(`${checkout.replace(/[\\/]$/, "")}\\`));
    const legacy = machine.snapshot?.graph_repositories === undefined && inCheckout ? workspace.worktree : undefined;
    const local = proof?.common_directory || legacy?.repo_key;
    const path = proof?.root || legacy?.checkout_path || pane.cwd || "";
    const key = remote ? ["remote", remote] : local ? ["local", machine.id, local] : ["folder", machine.id, path || workspace.workspace_id];
    const id = `repository:${JSON.stringify(key)}`;
    const label = remote ? remote.replace(/^https:\/\//, "") : local ? (!proof && legacy?.repo_name) || path.split(/[\\/]/).filter(Boolean).at(-1) || t("Repository") : `${t("Folder")} · ${path.split(/[\\/]/).filter(Boolean).at(-1) || workspace.label}`;
    let hub = hubs.get(id);
    if (!hub) {
      hub = { id, kind: "repository", label, repositoryKey: remote ?? undefined, detail: remote ?? "" };
      hubs.set(id, hub);
    }
    hub.detail = [...new Set([hub.detail, `${machine.name} · ${workspace.label}`, path, ...terminal.node.detail?.split("\n") ?? []].filter(Boolean))].join("\n");
    edges.push({ id: `parent:${terminal.node.id}`, source: terminal.node.id, target: id, kind: "terminal-in-repository", evidence: remote ? "Git remote" : local ? "Local Git repository" : "Folder" });
  }
  // Old workspace focus links keep their exact terminal membership, without making shared hubs descendants.
  for (const machine of machines) for (const { workspace, children } of worktreeGroups(machine.snapshot?.workspaces ?? [])) {
    for (const member of [workspace, ...children]) {
      const workspaceIds = new Set((member === workspace ? [workspace, ...children] : [member]).map((item) => item.workspace_id));
      groups.push({ id: `workspace:${JSON.stringify([machine.id, member.workspace_id])}`, label: member.label, machineId: machine.id,
        nodeIds: terminals.filter((terminal) => terminal.machine.id === machine.id && workspaceIds.has(terminal.workspace.workspace_id)).map((terminal) => terminal.node.id) });
    }
  }
  return { nodes: [...hubs.values()], edges, groups };
}
