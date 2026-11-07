import { expect, it } from "bun:test";
import { moveFlowFixture } from "./flow.fixture.ts";
import { nativeFlowDriver } from "../../scripts/session-move-native-fixture.ts";

it.skipIf(process.env["OVIS_CODEX_MOVE_NATIVE_TEST"] !== "1")("moves actual Codex native history and scoped dirty work between two owned loopback runtime endpoints, then reconciles a lost launch response", async () => {
  const driver = nativeFlowDriver(), fixture = await moveFlowFixture(driver);
  try {
    await driver.initialize(fixture.home, fixture.source, fixture.root);
    let preview = await fixture.coordinator.moves.preview(fixture.request);
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toMatchObject({ code: "source_not_quiescent" });
    await fixture.exit();
    preview = await fixture.coordinator.moves.preview(fixture.request, preview.id);
    fixture.failLaunch();
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toThrow();
    expect(fixture.flock.read().sessions[0]!.current_execution_id).toBe(fixture.request.source_execution_id);
    fixture.restart(); expect((await fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).phase).toBe("complete");
    const transcript = await driver.inspect();
    expect(JSON.stringify(transcript)).toContain("Preserve this owned conversation and dirty work");
    expect(JSON.stringify(transcript)).toContain("Owned conversation retained");
    expect(fixture.verifyWork()).toMatchObject({ committed: "committed\n", staged: "staged\n", working: "working\n", selected: "selected work\n" });
    expect(fixture.counts()).toEqual({ creates: 1, launches: 1 });
  } finally { await fixture.close(); }
}, 60_000);
