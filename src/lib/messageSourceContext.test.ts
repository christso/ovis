import { afterEach, expect, it, spyOn } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Machine } from "../../shared/machines.ts";
import type { MessageSourceProof } from "../../shared/message-source.ts";
import * as api from "./api.ts";
import { useMessageSourceNavigation } from "./messageSourceContext.tsx";

let renderer: ReactTestRenderer | null = null;
const cleanups: (() => void)[] = [];
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = null; for (const clean of cleanups.splice(0)) clean(); });

it("honors a later source click even when the earlier lookup finishes first", async () => {
  const firstId = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
  const source = { server_id: "pc", boot_id: "boot", terminal_id: "a", agent_instance_id: "process-a", pane_id: "a", agent: "codex", name: "Worker" };
  const pending = new Map<string, (value: { sender: MessageSourceProof }) => void>();
  const read = spyOn(api, "fetchMessageSource").mockImplementation((id) => new Promise((resolve) => pending.set(id, resolve))); cleanups.push(() => read.mockRestore());
  const resolve = spyOn(api, "resolveMessageSource").mockImplementation(async (source) => ({ pane_id: source.pane_id })); cleanups.push(() => resolve.mockRestore());
  const machines = { current: [{ id: "local", kind: "local", name: "Local", enabled: true, state: "connected", error: null, snapshot: null }] as Machine[] };
  const picks = { current: 0 }, selected: string[] = [];
  const select = { current: (_machine: string, pane: string | null) => { selected.push(pane!); picks.current++; } };
  let open: (receiver: string, id: string) => Promise<boolean>;
  function Probe() { open = useMessageSourceNavigation({ machines, picks, select, refresh: async () => {} }); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  const first = open!("local", firstId), second = open!("local", secondId);
  pending.get(firstId)!({ sender: { id: firstId, source } });
  expect(await first).toBe(false);
  expect(selected).toEqual([]);
  pending.get(secondId)!({ sender: { id: secondId, source: { ...source, terminal_id: "b", pane_id: "b", agent_instance_id: "process-b" } } });
  expect(await second).toBe(true);
  expect(selected).toEqual(["b"]);
});
