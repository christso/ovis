import { pushPaneTitle } from "../../../shared/notify-policy.ts";
import { rollupStatus } from "../../lib/status.ts";
import type { GraphNode } from "./graphModel.ts";
import type { graphTabs } from "./graphTabs.ts";

type Tab = ReturnType<typeof graphTabs>[number];

export function graphPanes(tabs: readonly Tab[]) {
  return tabs.flatMap((tab) => tab.panes.map((pane, index) => {
    const live = tab.machine.state === "connected" && !!tab.machine.snapshot?.herdr_lifetime && !!pane.terminal_id && !pane.restore_error;
    const node: GraphNode = {
      id: `pane:${JSON.stringify([tab.machine.id, tab.machine.snapshot?.herdr_lifetime ?? null, pane.workspace_id, pane.tab_id, tab.occupants[index]])}`,
      kind: "pane", label: pushPaneTitle(pane), machineId: tab.machine.id,
      status: live ? rollupStatus([pane.agent_status]) : "unknown",
      freshness: live ? "live" : tab.machine.state !== "connected" ? "disconnected" : "unavailable",
      detail: [...new Set([pane.pane_id, pane.display_agent || pane.agent, pane.cwd, pane.agent_session?.kind === "id" ? pane.agent_session.value : null].filter(Boolean))].join("\n"),
    };
    return { ...tab, node, panes: [pane], parentId: tab.node.id };
  }));
}
