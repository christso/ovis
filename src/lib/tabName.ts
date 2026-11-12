import type { HerdrTab, PaneInfo } from "../../shared/protocol.ts";
import { pasteFolder } from "./pasteFolders.ts";
import { attachmentTabLabel, tabLabelKey } from "./tabLabels.ts";

import { agentPaneName, customTabLabel } from "../../shared/tab-name.ts";
export { agentPaneName, customTabLabel } from "../../shared/tab-name.ts";
type TabPane = Parameters<typeof agentPaneName>[0] & Pick<PaneInfo, "pane_id" | "terminal_id">;

/** herdr names a tab by its place until it is renamed: the strip says so in words. */
export function tabLabel(tab: Pick<HerdrTab, "label" | "number">, t: (key: string, vars?: Record<string, string | number>) => string, place: number = tab.number): string {
  return customTabLabel(tab, place) ?? t("Tab {n}", { n: place });
}

/**
 * The label a tab takes from its agent's own name for its conversation (`agentPaneName`), else from
 * its first message (lib/tabLabels.ts): only while herdr names it by its number, never over a name
 * someone gave it (Rename tab, the New tab dialog's Name, a script, an agent's name typed as one).
 * `panes` are the tab's, in the order whose label wins; null when none has one. The tab's hover
 * stays its pane's title.
 */
export function autoTabLabel(tab: Pick<HerdrTab, "label" | "number">, panes: readonly TabPane[], machineId: string, labels: Readonly<Record<string, string>>, place: number = tab.number): string | null {
  if (customTabLabel(tab, place) !== null) return null;
  for (const pane of panes) {
    const learned = labels[tabLabelKey(machineId, pane)];
    const label = agentPaneName(pane, pasteFolder(machineId)) ?? (learned && !attachmentTabLabel(learned) ? learned : null);
    if (label) return label;
  }
  return null;
}
