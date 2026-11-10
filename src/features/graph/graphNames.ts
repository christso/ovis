import type { Machine } from "../../../shared/machines.ts";
import type { HerdrTab } from "../../../shared/protocol.ts";
import type { Translate } from "../../lib/i18n.ts";
import { autoTabLabel, customTabLabel, tabLabel } from "../../lib/tabName.ts";

export function graphTabNames(machine: Machine, tab: HerdrTab, labels: Readonly<Record<string, string>>, t: Translate) {
  const snapshot = machine.snapshot;
  const siblings = snapshot?.tabs.filter((item) => item.workspace_id === tab.workspace_id) ?? [];
  const place = siblings.indexOf(tab) + 1;
  const workspace = snapshot?.workspaces.find((item) => item.workspace_id === tab.workspace_id);
  const panes = snapshot?.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id) ?? [];
  return {
    custom: customTabLabel(tab, place),
    automatic: autoTabLabel(tab, panes, machine.id, labels, place),
    numbered: workspace?.worktree?.is_linked_worktree ? tabLabel(tab, t, place) : [workspace?.label, tabLabel(tab, t, place)].filter(Boolean).join(" · "),
  };
}
