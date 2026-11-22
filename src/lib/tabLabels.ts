/**
 * A few words of each agent pane's first message, shared with the other browsers of the server
 * (the `tab_labels` of shared/preferences.ts, through lib/preferencesSync.ts). A tab herdr still
 * names by its number shows them (lib/tabName.ts autoTabLabel), so tabs of the same agent tell
 * apart (#2019). It is an Ovis display name only: herdr's tab label is never written, so herdr's
 * own tab row and its other clients keep theirs.
 *
 * A label is keyed with the pane's PC, its id and its terminal (`tabLabelKey`): herdr reuses pane
 * ids after a restart, never a terminal id, so a new pane never shows an old one's words. A label
 * leaves once this page saw its pane and then saw it gone (`settleTabLabels`), and the server drops
 * all when the setting is turned off. Only the short label is kept, never the message.
 *
 * A line is learned once per pane, from what Ovis knows first: the New tab dialog's first message,
 * a transcript read from its beginning, or a Chat send delivered to a pane with no transcript. It
 * is first held by pane id (`pending`) and keyed once the pane's terminal is seen in a snapshot.
 * Only a user's own action shares it (the dialog's Start, a message delivered from Chat to an agent's
 * pane): a label read from a transcript is this page's alone (`shownTabLabels`) until then, so
 * reading or watching a pane never writes the shared preferences.
 */

import type { Machine } from "../../shared/machines.ts";
import { paneStorageId } from "../../shared/machines.ts";
import { capTabLabels } from "../../shared/preferences.ts";
import type { ConversationResponse, ConversationTurn, PaneInfo } from "../../shared/protocol.ts";
import { pasteFolder } from "./pasteFolders.ts";
import { attachmentTabLabel, shortTabLabel } from "../../shared/tab-label.ts";
export { attachmentTabLabel, shortTabLabel, SHORT_TAB_LABEL_COLUMNS } from "../../shared/tab-label.ts";

let labels: Readonly<Record<string, string>> = {};
let localLabels: Readonly<Record<string, string>> = {};
let shown: Readonly<Record<string, string>> = {};
const listeners = new Set<() => void>();
const pending = new Map<string, { label: string; shared: boolean }>();
let learning = true;
const seen = new Set<string>();
const gone = new Set<string>();

export function tabLabelKey(machineId: string, pane: Pick<PaneInfo, "pane_id" | "terminal_id">): string {
  return `${paneStorageId(machineId, pane.pane_id)}|${pane.terminal_id}`;
}

export function currentTabLabels(): Readonly<Record<string, string>> {
  return labels;
}

const sameMap = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => {
  const before = Object.entries(a);
  const after = Object.entries(b);
  return before.length === after.length && after.every(([key, line], index) => before[index]?.[0] === key && before[index]?.[1] === line);
};

function changed(): void {
  shown = { ...localLabels, ...labels };
  for (const listener of [...listeners]) listener();
}

export function setTabLabels(next: Readonly<Record<string, string>>): void {
  if (sameMap(labels, next)) return;
  labels = { ...next };
  changed();
}

function setLocalLabels(next: Readonly<Record<string, string>>): void {
  if (sameMap(localLabels, next)) return;
  localLabels = { ...next };
  changed();
}

export function shownTabLabels(): Readonly<Record<string, string>> {
  return shown;
}

export function subscribeTabLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The setting, and whether this device may learn (a watching device takes the labels and learns none). */
export function setTabLabelLearning(setting: boolean, watching: boolean): void {
  learning = setting && !watching;
  if (!learning) pending.clear();
  if (!setting) setLocalLabels({});
}

export function learnTabLabel(machineId: string, paneId: string, text: string, shared = true): void {
  if (!learning) return;
  const id = paneStorageId(machineId, paneId);
  const held = pending.get(id);
  if (held !== undefined) { if (shared && !held.shared) { held.shared = true; changed(); } return; }
  const label = shortTabLabel(text, pasteFolder(machineId));
  if (label === null) return;
  pending.set(id, { label, shared });
  changed();
}

export function settleTabLabels(machines: readonly Pick<Machine, "id" | "state" | "snapshot">[]): void {
  const authoritative = machines.filter((machine) => machine.state === "connected" && machine.snapshot !== null);
  const live = new Map<string, string>();
  for (const machine of authoritative) for (const pane of machine.snapshot!.panes) live.set(paneStorageId(machine.id, pane.pane_id), tabLabelKey(machine.id, pane));
  const liveKeys = new Set(live.values());
  const onPc = (key: string, machineId: string): boolean => machineId === "local" ? !key.startsWith("remote:") : key.startsWith(paneStorageId(machineId, ""));
  const keep = (map: Readonly<Record<string, string>>): Record<string, string> => {
    const kept: Record<string, string> = {};
    for (const [key, label] of Object.entries(map)) {
      if (attachmentTabLabel(label)) continue;
      if (liveKeys.has(key)) { seen.add(key); kept[key] = label; continue; }
      if (seen.has(key) && authoritative.some((machine) => onPc(key, machine.id))) { seen.delete(key); gone.add(key); }
      if (!gone.has(key)) kept[key] = label;
    }
    return kept;
  };
  const next = keep(labels);
  const local = keep(localLabels);
  for (const [id, { label, shared }] of pending) {
    const key = live.get(id);
    if (key === undefined) continue;
    pending.delete(id);
    if (key in next || gone.has(key)) continue;
    seen.add(key);
    if (shared) { next[key] = local[key] ?? label; delete local[key]; }
    else if (!(key in local)) local[key] = label;
  }
  for (const key of Object.keys(local)) if (key in next) delete local[key];
  setLocalLabels(capTabLabels(local));
  setTabLabels(capTabLabels(next));
}

const untranscribed = new Set<string>();

export function learnFromConversation(machineId: string, paneId: string, conversation: Pick<ConversationResponse, "source" | "cursor" | "turns">): void {
  const id = paneStorageId(machineId, paneId);
  if (conversation.source === "scrollback") { untranscribed.add(id); return; }
  untranscribed.delete(id);
  if (conversation.cursor !== null) return;
  const first = firstPromptOf(conversation.turns);
  if (first !== null) learnTabLabel(machineId, paneId, first, false);
}

export function learnFromSend(machineId: string, paneId: string, agent: string | null | undefined, text: string): void {
  if (!agent || !learning) return;
  const id = paneStorageId(machineId, paneId);
  const own = Object.keys(localLabels).filter((key) => key.startsWith(`${id}|`));
  if (own.length > 0) {
    setTabLabels(capTabLabels({ ...labels, ...Object.fromEntries(own.map((key) => [key, localLabels[key]!])) }));
    setLocalLabels(Object.fromEntries(Object.entries(localLabels).filter(([key]) => !own.includes(key))));
    return;
  }
  const held = pending.get(id);
  if (held !== undefined) { held.shared = true; changed(); return; }
  if (untranscribed.has(id)) learnTabLabel(machineId, paneId, text);
}

export function forgetTabLabelsForTests(): void {
  labels = {};
  localLabels = {};
  shown = {};
  pending.clear();
  seen.clear();
  gone.clear();
  untranscribed.clear();
  learning = true;
}

export function firstPromptOf(turns: readonly ConversationTurn[]): string | null {
  const first = turns.find((turn) => turn.role === "user" && turn.parts.some((part) => part.kind === "text" && part.text.trim() !== ""));
  if (!first) return null;
  return first.parts.flatMap((part) => part.kind === "text" ? [part.text] : []).join("\n");
}
