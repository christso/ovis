import { afterEach, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexCoordinationObservations, retainCodexCoordinationScans } from "./codex-relationships.ts";

const own = "11111111-1111-4111-8111-111111111111", child = "a2222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;
const header = (id = own) => line({ type: "session_meta", payload: { id, source: "cli" } });
const activity = (id: string, kind = "started", thread = own, target = child) => ({ timestamp: "2026-11-08T00:00:00Z", type: "event_msg", payload: {
  type: "item_completed", thread_id: thread, item: { type: "SubAgentActivity", id, kind, agent_thread_id: target, agent_path: "/discard/private", message: "private prompt" }, completed_at_ms: 1794096000000 } });
function fixture(text: string) {
  const root = mkdtempSync(join(tmpdir(), "ovis-codex-relations-")); roots.push(root);
  const path = join(root, "rollout.jsonl"); writeFileSync(path, text); return path;
}

it("records only successful own-thread completed activity and retains no message content", async () => {
  const path = fixture(header() + [activity("spawn"), activity("send", "interacted"), activity("wait", "waiting"), activity("ancestor", "started", other),
    activity("self", "started", own, own), activity("bad-id", "started", own, "not-a-uuid"),
    { ...activity("unfinished"), payload: { ...activity("unfinished").payload, type: "item_started" } },
    { type: "response_item", payload: { type: "function_call", name: "send_message", arguments: JSON.stringify({ target: child, message: "private prompt" }) } },
    { type: "event_msg", payload: { type: "collab_agent_interaction_end", receiver_thread_id: child } },
  ].map(line).join(""));
  const events = await codexCoordinationObservations(path, own);
  expect(events).toEqual([
    { id: "spawn", kind: "delegation", source_native_session_id: own, target_native_session_id: child, occurred_at: "2026-11-08T00:00:00.000Z", source: "codex" },
    { id: "send", kind: "communication", source_native_session_id: own, target_native_session_id: child, occurred_at: "2026-11-08T00:00:00.000Z", source: "codex" },
  ]);
  expect(JSON.stringify(events)).not.toContain("private");
  expect(await codexCoordinationObservations(path, own)).toEqual(events);
});

it("waits for complete lines and deduplicates repeated receipts across appends", async () => {
  const pending = line(activity("send", "interacted"));
  const path = fixture(header() + pending.slice(0, -8));
  expect(await codexCoordinationObservations(path, own)).toEqual([]);
  appendFileSync(path, pending.slice(-8));
  expect(await codexCoordinationObservations(path, own)).toHaveLength(1);
  appendFileSync(path, pending + line(activity("second", "interacted")));
  expect((await codexCoordinationObservations(path, own)).map((event) => event.id)).toEqual(["send", "second"]);
});

it("keeps the first successful event identity and normalizes the target UUID without retaining duplicate metadata", async () => {
  const original = activity("send", "interacted", own, child.toUpperCase());
  const duplicate = { ...activity("send", "started", own, other), timestamp: "2026-11-09T00:00:00Z", private: "never retain duplicate metadata" };
  const path = fixture(header() + line(original) + line(duplicate));
  expect(await codexCoordinationObservations(path, own)).toEqual([
    { id: "send", kind: "communication", source_native_session_id: own, target_native_session_id: child, occurred_at: "2026-11-08T00:00:00.000Z", source: "codex" },
  ]);
});

it("rejects changed headers and resets on replacement or truncation", async () => {
  const path = fixture(header() + line(activity("old")));
  expect(await codexCoordinationObservations(path, own)).toHaveLength(1);
  const replacement = `${path}.replacement`;
  writeFileSync(replacement, header(other) + line(activity("foreign")));
  renameSync(replacement, path);
  expect(await codexCoordinationObservations(path, own)).toEqual([]);
  writeFileSync(path, header() + line(activity("new")));
  expect((await codexCoordinationObservations(path, own)).map((event) => event.id)).toEqual(["new"]);
  writeFileSync(path, header());
  expect(await codexCoordinationObservations(path, own)).toEqual([]);
});

it("progresses through bounded reads and skips oversized records without blocking later receipts", async () => {
  const noise = line({ type: "response_item", payload: "x".repeat(512 * 1024) });
  const path = fixture(header() + noise.repeat(12) + line(activity("after-large-history")));
  expect(await codexCoordinationObservations(path, own)).toEqual([]);
  const events = await codexCoordinationObservations(path, own);
  expect(events.map((event) => event.id)).toEqual(["after-large-history"]);
});

it("keeps progress for more than sixteen active rollouts with receipts past the first scan budget", async () => {
  const noise = line({ type: "response_item", payload: "x".repeat(512 * 1024) });
  const paths = Array.from({ length: 17 }, (_, index) => fixture(header() + noise.repeat(9) + line(activity(`late-${index}`))));
  for (const path of paths) expect(await codexCoordinationObservations(path, own)).toEqual([]);
  retainCodexCoordinationScans(new Set(paths));
  const events = [];
  for (const path of paths) events.push(...await codexCoordinationObservations(path, own));
  expect(events.map((event) => event.id)).toEqual(paths.map((_, index) => `late-${index}`));
});

it("discards cursors and old event metadata for rollouts outside the verified active census", async () => {
  const noise = line({ type: "response_item", payload: "x".repeat(512 * 1024) });
  const active = fixture(header() + noise.repeat(9) + line(activity("active")));
  const inactive = fixture(header() + noise.repeat(9) + line(activity("inactive")));
  await codexCoordinationObservations(active, own); await codexCoordinationObservations(inactive, own);
  retainCodexCoordinationScans(new Set([active]));
  expect((await codexCoordinationObservations(active, own)).map((event) => event.id)).toEqual(["active"]);
  // A source removed from the census starts a fresh bounded scan when it reappears.
  expect(await codexCoordinationObservations(inactive, own)).toEqual([]);
});

it.skipIf(process.platform === "win32")("refuses a symlink even when its file has a matching header", async () => {
  const path = fixture(header() + line(activity("hidden"))), alias = `${path}.link`;
  symlinkSync(path, alias);
  expect(await codexCoordinationObservations(alias, own)).toEqual([]);
});
