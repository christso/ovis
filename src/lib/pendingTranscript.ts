import type { ConversationTurn, PendingMessage } from "../../shared/protocol.ts";
import { paneLifetimes } from "./paneLifetime.ts";
import { currentWaitingSends, subscribeWaitingSends, transcriptTurnMatcher, waitingBaseline, type WaitingBaseline } from "./sentWaiting.ts";

interface Attempt {
  key: string;
  id: string;
  text: string;
  history: string;
  at: number;
  after: WaitingBaseline;
  completed: boolean;
}

const histories = new Map<string, string>();
const attempts = new Map<string, Attempt>();
const identity = (key: string, id: string): string => JSON.stringify([key, "pending", id]);

function retainAttempt(name: string, attempt: Attempt): void {
  attempts.set(name, attempt);
  if (attempts.size > 256) attempts.delete(attempts.keys().next().value!);
}

function reserveOrdinarySends(key: string, history: string): void {
  for (const send of currentWaitingSends(key)) {
    const name = JSON.stringify([key, "ordinary", send.id]);
    if (send.after === null || attempts.has(name)) continue;
    retainAttempt(name, { key, history, id: String(send.id), text: send.text, at: send.at, after: send.after, completed: true });
  }
}

subscribeWaitingSends(() => {
  for (const [key, history] of histories) reserveOrdinarySends(key, history);
});

export function observePendingTranscript(key: string, history: string | undefined): void {
  if (histories.get(key) === history) return;
  forgetPendingTranscript(key);
  if (history === undefined) return;
  histories.set(key, history);
  reserveOrdinarySends(key, history);
  if (histories.size > 64) forgetPendingTranscript(histories.keys().next().value!);
}

export function capturePendingAttempt(key: string, id: string, text: string, at = Date.now()): void {
  const name = identity(key, id);
  attempts.delete(name);
  const history = histories.get(key), after = waitingBaseline(key);
  if (history === undefined || after === null) return;
  retainAttempt(name, { key, id, text, history, at, after, completed: false });
}

export function completePendingAttempt(key: string, id: string): void {
  const attempt = attempts.get(identity(key, id));
  if (attempt) attempt.completed = true;
}

export function forgetPendingAttempt(key: string, id: string): void { attempts.delete(identity(key, id)); }

export function pendingTranscriptMatches(key: string, history: string | undefined, rows: readonly PendingMessage[], turns: readonly ConversationTurn[]): Map<number, string> {
  const result = new Map<number, string>();
  if (history === undefined || histories.get(key) !== history || !rows.some((row) => row.state === "uncertain")) return result;
  const matchesTurn = transcriptTurnMatcher(turns);
  const candidates = [...attempts.values()].filter((attempt) => attempt.key === key && attempt.history === history).map((attempt) => {
    const matches = matchesTurn(attempt.text, attempt.at, attempt.after);
    return { attempt, matches: attempt.completed ? matches.slice(0, 1) : matches };
  });
  const counts = new Map<number, number>();
  for (const { matches } of candidates) for (const index of matches) counts.set(index, (counts.get(index) ?? 0) + 1);
  for (const { attempt, matches } of candidates) {
    const row = rows.find((row) => row.id === attempt.id);
    if (!attempt.completed && row?.state === "uncertain" && row.text === attempt.text && matches.length === 1 && counts.get(matches[0]!) === 1) result.set(matches[0]!, row.id);
  }
  return result;
}

export function forgetPendingTranscript(key: string): void {
  histories.delete(key);
  for (const [id, attempt] of attempts) if (attempt.key === key) attempts.delete(id);
}

paneLifetimes.onRetire((machineId) => {
  for (const key of histories.keys()) if (key.startsWith(`${machineId}:`)) forgetPendingTranscript(key);
});
