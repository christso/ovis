import type { FlockRow } from "../../../shared/flock-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { autoTabLabel, customTabLabel, tabLabel } from "../../lib/tabName.ts";

const meaningful = (name: string | null | undefined, launcher: string) => name?.trim() && ![launcher.toLocaleLowerCase(), "codex", "claude", "agent"].includes(name.trim().toLocaleLowerCase()) ? name.trim() : null;

export function graphExecutionName(row: FlockRow, machines: readonly Machine[], labels: Readonly<Record<string, string>>, t: Translate = defaultTranslate): string {
  const pane = row.pane, snapshot = machines.find((machine) => machine.id === row.machine_id)?.snapshot;
  const agent = snapshot?.agents.find((agent) => agent.pane_id === pane?.pane_id && agent.terminal_id === pane?.terminal_id);
  const launcher = agent?.display_agent?.trim() || pane?.display_agent?.trim() || row.execution?.agent || pane?.agent || "";
  const tab = snapshot?.tabs.find((tab) => tab.tab_id === pane?.tab_id);
  const siblings = snapshot?.tabs.filter((item) => item.workspace_id === tab?.workspace_id) ?? [];
  const place = tab ? siblings.indexOf(tab) + 1 : 0;
  const tabName = tab ? customTabLabel(tab, place) ?? autoTabLabel(tab, snapshot!.panes.filter((item) => item.tab_id === tab.tab_id), row.machine_id, labels, place) : null;
  const workspace = snapshot?.workspaces.find((workspace) => workspace.workspace_id === pane?.workspace_id);
  const numberedTab = tab ? [workspace?.label, tabLabel(tab, t, place)].filter(Boolean).join(" · ") : null;
  const name = row.session?.name || meaningful(pane?.label, launcher) || tabName || meaningful(agent?.name, launcher) || meaningful(row.name, launcher) || (numberedTab || pane?.pane_id) || row.name;
  return launcher ? `${name} · ${launcher}` : name;
}
