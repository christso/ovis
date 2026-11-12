/** Send-time display text is a snapshot, never part of current terminal/process proof. */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HerdrCoordinationEndpoint } from "../shared/graph-registry.ts";
import type { SessionSnapshot } from "../shared/herdr-api.generated.ts";
import { messageSourceLabel } from "../shared/message-source.ts";
import { sharedPreferencesBody } from "../shared/preferences.ts";
import { agentPaneName, customTabLabel } from "../shared/tab-name.ts";
import { sessionSnapshot } from "./herdr/client.ts";

function displayLabel(value: string | null | undefined): string | null {
  const label = messageSourceLabel(value ?? "").trim();
  return !label || /[/\\]/.test(label) ? null : label;
}

/** A source pane's own name wins over a sibling's automatic tab title. No folder fallback. */
export function peerDisplayName(snapshot: SessionSnapshot, source: HerdrCoordinationEndpoint, labels: Readonly<Record<string, string>> = {}, automatic = true): string | undefined {
  const pane = snapshot.panes.find((pane) => pane.pane_id === source.pane_id && pane.terminal_id === source.terminal_id && pane.agent === source.agent && !pane.restore_error);
  if (!pane) return undefined;
  const tab = snapshot.tabs.find((tab) => tab.tab_id === pane.tab_id && tab.workspace_id === pane.workspace_id);
  const siblings = snapshot.tabs.filter((tab) => tab.workspace_id === pane.workspace_id);
  return displayLabel(pane.label) ?? displayLabel(tab ? customTabLabel(tab, siblings.indexOf(tab) + 1) : null)
    ?? (automatic ? displayLabel(agentPaneName({ ...pane, label: null })) ?? displayLabel(labels[`${pane.pane_id}|${pane.terminal_id}`]) : null)
    ?? displayLabel(source.name) ?? displayLabel(source.agent) ?? undefined;
}

/** Read only bounded, regular local state files. Never consult another PC's preference keys. */
function document(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    return stat.isFile() && stat.size <= 262144 ? JSON.parse(readFileSync(fd, "utf8")) : null;
  } finally { closeSync(fd); }
}

export async function observePeerDisplayName(socket: string, source: HerdrCoordinationEndpoint, stateDir?: string): Promise<string | undefined> {
  try {
    let labels: Record<string, string> = {}, automatic = true;
    if (stateDir) {
      try { automatic = sharedPreferencesBody(document(join(stateDir, "preferences.json")))?.settings.autoTabNames !== false; } catch {}
      try { labels = sharedPreferencesBody({ settings: {}, ...document(join(stateDir, "tab-labels.json")) as object })?.tab_labels ?? {}; } catch {}
    }
    return peerDisplayName(await sessionSnapshot(socket, 500), source, labels, automatic);
  } catch { return undefined; }
}
