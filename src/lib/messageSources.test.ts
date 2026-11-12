import { afterEach, expect, it, spyOn } from "bun:test";
import type { Machine } from "../../shared/machines.ts";
import * as api from "./api.ts";
import { findMessageSource } from "./messageSources.ts";

const id = "11111111-1111-4111-8111-111111111111";
const source = { server_id: "source-pc", boot_id: "daemon", terminal_id: "stable-terminal", agent_instance_id: "process", agent: "codex", pane_id: "old-pane", name: "Worker" };
const machines: Machine[] = ["receiver", "source", "collision", "offline"].map((id) => ({ id, name: "same display name", kind: "ssh", enabled: true, state: id === "offline" ? "disconnected" : "connected", error: null, snapshot: null }));
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });

it("uses the receiving PC's exact receipt, and fresh source proof on the correct connected PC", async () => {
  const read = spyOn(api, "fetchMessageSource").mockResolvedValue({ sender: { id, source } }); cleanups.push(() => read.mockRestore());
  const resolve = spyOn(api, "resolveMessageSource").mockImplementation(async (endpoint, machine) => {
    expect(endpoint).toEqual(source);
    return { pane_id: machine === "source" ? "moved-pane" : null };
  }); cleanups.push(() => resolve.mockRestore());
  expect(await findMessageSource(id, "receiver", machines)).toEqual({ machine_id: "source", pane_id: "moved-pane", source });
  expect(read.mock.calls).toEqual([[id, "receiver"]]);
  expect(resolve.mock.calls.map((call) => call[1]).sort()).toEqual(["collision", "receiver", "source"]);
  resolve.mockResolvedValue({ pane_id: null });
  expect(await findMessageSource(id, "receiver", machines)).toBeNull();
  resolve.mockResolvedValue({ pane_id: "same-pane-number" });
  expect(await findMessageSource(id, "receiver", machines)).toBeNull();
});

it("rejects missing, malformed or unrelated receipts before destination lookup", async () => {
  const read = spyOn(api, "fetchMessageSource").mockResolvedValue({ sender: null }); cleanups.push(() => read.mockRestore());
  const resolve = spyOn(api, "resolveMessageSource").mockResolvedValue({ pane_id: "replacement" }); cleanups.push(() => resolve.mockRestore());
  expect(await findMessageSource("../malformed", "receiver", machines)).toBeNull();
  expect(await findMessageSource(id, "offline", machines)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(await findMessageSource(id, "receiver", machines)).toBeNull();
  read.mockResolvedValue({ sender: { id: "another-receipt", source } });
  expect(await findMessageSource(id, "receiver", machines)).toBeNull();
  read.mockResolvedValue({ sender: { id, source: { ...source, terminal_id: "" } } });
  expect(await findMessageSource(id, "receiver", machines)).toBeNull();
  expect(resolve).not.toHaveBeenCalled();
});
