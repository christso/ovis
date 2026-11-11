import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { herdrCliObservations, herdrCliSnapshot, recordHerdrCli } from "./herdr/cli-observations.ts";

it.skipIf(process.platform === "win32")("reads 150 current occupants with one process probe each and skips a bad journal entry within its batch", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-cli-reader-")), socket = join(root, "api.sock"), journal = join(root, "journal");
  const agents = Array.from({ length: 150 }, (_, index) => ({ terminal_id: `fixture-terminal-${index}`, pane_id: `fixture-pane-${index}`, agent: "codex", name: null }));
  const snapshot = { herdr_lifetime: "fixture-lifetime", agents, panes: agents.map((agent) => ({ ...agent })), tabs: [], workspaces: [] } as unknown as SessionSnapshot;
  const calls: string[] = [];
  const server = Bun.listen<{ text: string }>({ unix: socket, socket: {
    open(client) { client.data = { text: "" }; },
    data(client, bytes) {
      client.data.text += bytes.toString();
      if (!client.data.text.endsWith("\n")) return;
      const request = JSON.parse(client.data.text) as { id: string; method: string; params: { pane_id?: string; target?: string } };
      calls.push(request.method);
      const agent = agents.find((agent) => agent.pane_id === (request.params.pane_id ?? request.params.target));
      const result = request.method === "agent.get" ? { agent } : { process_info: { pane_id: agent!.pane_id, shell_pid: 1, foreground_processes: [{ pid: process.pid, name: "codex", argv: ["/fixture/codex"] }] } };
      client.end(JSON.stringify({ id: request.id, result }) + "\n");
    },
  } });
  try {
    const started = performance.now(), page = await herdrCliSnapshot(snapshot, socket, journal), elapsed = performance.now() - started;
    expect(page?.agents).toHaveLength(150);
    expect(calls).toHaveLength(150); expect(new Set(calls)).toEqual(new Set(["pane.process_info"]));
    expect(elapsed).toBeLessThan(5000);
    console.log(`CLI Graph reader: 150 occupants, ${calls.length} RPCs, ${elapsed.toFixed(1)} ms`);
    const first = { id: randomUUID(), kind: "communication" as const, producer: "herdr-cli" as const, scope: "terminal" as const, source_terminal: page!.agents[0]!, target_terminal: page!.agents[1]!, occurred_at: "2026-11-11T00:00:00Z" };
    const second = { ...first, id: randomUUID() };
    recordHerdrCli(socket, first, journal); recordHerdrCli(socket, second, journal);
    const directory = join(journal, readdirSync(journal)[0]!);
    const files = readdirSync(directory).filter((file) => file !== "identity.json");
    // Corrupt whichever immutable event the filesystem will enumerate first.
    const invalid = join(directory, files[0]!), valid = JSON.parse(readFileSync(join(directory, files[1]!), "utf8"));
    writeFileSync(invalid, "{ malformed fixture");
    const recovered = await herdrCliObservations(socket, journal);
    expect(recovered?.receipts).toHaveLength(1); expect(recovered?.receipts[0]?.id).toBe(valid.receipt.id);
    expect(readFileSync(invalid, "utf8")).toBe("{ malformed fixture");
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});
