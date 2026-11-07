import { expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { moveFlowFixture } from "./flow.fixture.ts";

it.skipIf(process.platform === "win32")("transfers scoped dirty work across two owned HTTP nodes, rejects a loaded source, and retains logical identity", async () => {
  const fixture = await moveFlowFixture();
  try {
    const preview = await fixture.coordinator.moves.preview(fixture.request);
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toMatchObject({ code: "source_not_quiescent" });
    expect(existsSync(fixture.target)).toBe(false);
    await fixture.exit();
    const result = await fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint);
    expect(result.phase).toBe("complete");
    expect(fixture.verifyWork()).toMatchObject({ committed: "committed\n", staged: "staged\n", working: "working\n", selected: "selected work\n" });
    expect(existsSync(join(fixture.target, "excluded.txt"))).toBe(false);
    expect(readFileSync(join(fixture.source, "excluded.txt"), "utf8")).toBe("source only\n");
    const registry = fixture.flock.read();
    expect(registry.sessions[0]).toMatchObject({ id: fixture.registry.sessions[0]!.id, name: "Owned logical session", work_id: fixture.registry.works[0]!.id });
    expect(registry.executions).toHaveLength(2); expect(registry.sessions[0]!.current_execution_id).toBe(registry.executions[1]!.id);
    expect(fixture.counts()).toEqual({ creates: 1, launches: 1 });
  } finally { await fixture.close(); }
});
for (const failure of ["chunk", "launch"] as const) it.skipIf(process.platform === "win32")(`recovers an acknowledged ${failure} step whose HTTP response was lost without duplicate native execution`, async () => {
  const fixture = await moveFlowFixture();
  try {
    const preview = await fixture.coordinator.moves.preview(fixture.request); await fixture.exit();
    if (failure === "chunk") fixture.failChunk(); else fixture.failLaunch();
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toThrow();
    expect(fixture.flock.read().sessions[0]!.current_execution_id).toBe(fixture.request.source_execution_id);
    fixture.restart();
    expect((await fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).phase).toBe("complete");
    expect(fixture.counts()).toEqual({ creates: 1, launches: 1 });
    expect(fixture.verifyWork().working).toBe("working\n");
  } finally { await fixture.close(); }
});
