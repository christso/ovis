import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraphCliObservation } from "../shared/graph-registry.ts";
import type { Machine } from "../shared/machines.ts";
import { graphRelationships } from "../shared/graph-relationships.ts";
import { graphSourceMachines } from "../src/lib/graphRegistryInventory.ts";
import { GraphRegistryStore, handleGraphRequest } from "./graph-registry.ts";

const endpoint = (terminal_id: string) => ({ server_id: "cli-server", boot_id: "cli-boot", terminal_id, pane_id: `pane-${terminal_id}`, agent: "codex", name: "Captured label" });
const receipt: GraphCliObservation = { id: "cli-receipt", kind: "delegation", producer: "herdr-cli", scope: "terminal", source_terminal: endpoint("source"), target_terminal: endpoint("target"), occurred_at: "2026-11-11T00:00:00Z" };
const machine = (): Machine => ({ id: "local", name: "Local", kind: "local", enabled: true, state: "connected", error: null,
  snapshot: { protocol: 1, version: "fixture", agents: [], layouts: [], panes: [], tabs: [], workspaces: [], herdr_lifetime: "cli-boot", graph_cli: { version: 1, server_id: "cli-server", boot_id: "cli-boot", receipts: [receipt] } } });

it("keeps terminal receipts separate, strips content, deduplicates replay and preserves malformed stored formats", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-cli-store-"));
  try {
    const source = machine(), store = new GraphRegistryStore(root);
    Object.assign(source.snapshot!.graph_cli!.receipts[0]!, { message: "private prompt fixture", argv: ["private argument"] });
    const registry = store.observe([source]);
    expect(registry.cli_observations).toHaveLength(1); expect(registry.observations).toBeUndefined(); expect(registry.herdr_associations).toBeUndefined();
    expect(graphRelationships(registry)[0]?.target).toMatchObject({ terminal: endpoint("target"), native_session_id: "", session_id: null });
    expect(readFileSync(join(root, "flock.json"), "utf8")).not.toContain("private");
    expect(store.observe([source]).revision).toBe(registry.revision);
    expect(new GraphRegistryStore(root).read()).toEqual(registry);
    store.change(registry.revision, { type: "create-work", name: "Unrelated native work" }, []);
    expect(store.read().cli_observations).toEqual(registry.cli_observations);
    const invalid = { ...store.read(), cli_observations: [{ ...receipt, machine_id: source.id, scope: "agent-occupancy" }] };
    const bytes = JSON.stringify(invalid); writeFileSync(join(root, "flock.json"), bytes);
    expect(() => store.observe([source])).toThrow("preserved");
    expect(readFileSync(join(root, "flock.json"), "utf8")).toBe(bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("drops cached private terminal metadata when fresh source proof fails or the daemon changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-cli-private-"));
  try {
    const source = machine(), roster = machine();
    roster.snapshot!.herdr_lifetime = "replacement";
    expect(graphSourceMachines([roster], [source])[0]!.snapshot!.graph_cli).toBeUndefined();
    const response = await handleGraphRequest(new Request("http://localhost/api/flock?sources=1"), new GraphRegistryStore(root), [source], async () => { throw new Error("owned unavailable source"); });
    const body = await response.json();
    expect(body.sources[0].snapshot.graph_cli).toBeUndefined();
    expect(body.cli_observations).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
