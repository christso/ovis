import type { Translate } from "../../lib/i18n.ts";
import { STATUS_WORD } from "../../lib/status.ts";
import type { GraphKind, GraphNode, GraphRelation, GraphStatus } from "./graphModel.ts";

export const GRAPH_KINDS: GraphKind[] = ["workspace", "worktree", "terminal"];
export const GRAPH_STATUSES: GraphStatus[] = ["working", "blocked", "waiting", "done", "idle", "unknown"];
export const graphStatusLabel = (t: Translate, status: GraphStatus) => t(STATUS_WORD[status]);
export function graphNodeStatusLabel(t: Translate, node: GraphNode): string {
  const status = graphStatusLabel(t, node.status ?? "unknown");
  return node.hasWorkingTerminals && node.status !== "working" ? `${status} · ${graphStatusLabel(t, "working")}` : status;
}
export function graphKindLabel(t: Translate, kind: GraphKind): string {
  switch (kind) {
    case "workspace": return t("Workspace");
    case "worktree": return t("Worktree");
    case "terminal": return t("Terminal");
  }
}
export function graphFreshnessLabel(t: Translate, freshness: GraphNode["freshness"]): string {
  switch (freshness) {
    case "live": return t("Live");
    case "unavailable": return t("Unavailable");
    case "unsupported": return t("Identity unavailable");
    case "stale": return t("Stale source");
    case "disconnected": return t("Disconnected");
    default: return t("Unknown");
  }
}
export function graphRelationLabel(t: Translate, kind: GraphRelation): string {
  switch (kind) {
    case "worktree-in-workspace": return t("Worktree in workspace");
    case "terminal-in-workspace": return t("Terminal in workspace");
    case "terminal-in-worktree": return t("Terminal in worktree");
    case "delegation": return t("Recorded delegation");
    case "communication": return t("Communication");
  }
}
