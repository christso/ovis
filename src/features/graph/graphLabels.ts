import type { Translate } from "../../lib/i18n.ts";
import { STATUS_WORD } from "../../lib/status.ts";
import type { GraphKind, GraphNode, GraphRelation, GraphStatus } from "./graphModel.ts";

export const GRAPH_STATUSES: GraphStatus[] = ["working", "blocked", "waiting", "done", "idle", "unknown"];
export const graphStatusLabel = (t: Translate, status: GraphStatus) => t(STATUS_WORD[status]);
export function graphKindLabel(t: Translate, kind: GraphKind): string {
  switch (kind) {
    case "repository": return t("Repository");
    case "checkout": return t("Checkout");
    case "work": return t("Work");
    case "session": return t("Session");
    case "execution": return t("Execution");
    case "tab": return t("Tab");
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
    case "execution-in-checkout": return t("Executes in checkout");
    case "tab-in-checkout": return t("Tab in checkout");
    case "checkout-in-repository": return t("Checkout of repository");
    case "delegation": return t("Recorded delegation");
    case "communication": return t("Communication");
    case "session-execution": return t("Execution of session");
    case "work-session": return t("Session of work");
  }
}
