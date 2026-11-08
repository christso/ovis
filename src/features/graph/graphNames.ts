import type { FlockRow } from "../../../shared/flock-inventory.ts";
import type { Machine } from "../../../shared/machines.ts";
import type { HerdrTab } from "../../../shared/protocol.ts";
import { t as defaultTranslate, type Translate } from "../../lib/i18n.ts";
import { autoTabLabel, customTabLabel, tabLabel } from "../../lib/tabName.ts";

const meaningful = (name: string | null | undefined, launcher: string) => name?.trim() && ![launcher.toLocaleLowerCase(), "codex", "claude", "agent"].includes(name.trim().toLocaleLowerCase()) ? name.trim() : null;

export function graphTabNames(machine: Machine, tab: HerdrTab, labels: Readonly<Record<string, string>>, t: Translate) {
  const snapshot = machine.snapshot;
  const siblings = snapshot?.tabs.filter((item) => item.workspace_id === tab.workspace_id) ?? [];
  const place = siblings.indexOf(tab) + 1;
  const workspace = snapshot?.workspaces.find((item) => item.workspace_id === tab.workspace_id);
  return {
    custom: customTabLabel(tab, place),
    automatic: autoTabLabel(tab, snapshot?.panes.filter((pane) => pane.tab_id === tab.tab_id) ?? [], machine.id, labels, place),
    numbered: [workspace?.label, tabLabel(tab, t, place)].filter(Boolean).join(" · "),
  };
}

export function graphExecutionLabel(row: FlockRow, machines: readonly Machine[], labels: Readonly<Record<string, string>>, t: Translate = defaultTranslate) {
  const pane = row.pane, machine = machines.find((machine) => machine.id === row.machine_id), snapshot = machine?.snapshot;
  const agent = snapshot?.agents.find((agent) => agent.pane_id === pane?.pane_id && agent.terminal_id === pane?.terminal_id);
  const launcher = agent?.display_agent?.trim() || pane?.display_agent?.trim() || row.execution?.agent || pane?.agent || "";
  const tab = snapshot?.tabs.find((tab) => tab.tab_id === pane?.tab_id);
  const names = tab && machine ? graphTabNames(machine, tab, labels, t) : null;
  const name = row.session?.name || names?.custom || meaningful(pane?.label, launcher) || names?.automatic || meaningful(agent?.name, launcher) || meaningful(row.name, launcher) || (names?.numbered || pane?.pane_id) || row.name;
  return { label: launcher ? `${name} · ${launcher}` : name, namedTab: !!names?.custom };
}

export function graphExecutionName(row: FlockRow, machines: readonly Machine[], labels: Readonly<Record<string, string>>, t: Translate = defaultTranslate): string {
  return graphExecutionLabel(row, machines, labels, t).label;
}
