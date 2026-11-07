import { Database } from "bun:sqlite";
import { expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { privateStateFs } from "../private-state.ts";
import { FIXTURE_THREAD, moveFlowFixture } from "./flow.fixture.ts";
const owned = it.skipIf(process.platform === "win32");
function failReceipt(name: string) {
  const rename = privateStateFs.renameSync;
  return spyOn(privateStateFs, "renameSync").mockImplementation((before, after) => {
    if (basename(String(after)) === name) throw new Error(`owned crash before ${name}`);
    return rename(before, after);
  });
}
for (const interrupted of ["patches", "untracked"] as const) owned(`rebuilds private incomplete checkout after interruption during ${interrupted}, before publishing or binding`, async () => {
  const fixture = await moveFlowFixture(); let fault: ReturnType<typeof failReceipt> | undefined;
  try {
    writeFileSync(join(fixture.source, "later.txt"), "later selected work\n");
    const request = { ...fixture.request, untracked_files: ["selected.txt", "later.txt"] };
    const preview = await fixture.coordinator.moves.preview(request); await fixture.exit();
    fault = failReceipt("checkout-verified.json");
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toThrow(); fault.mockRestore(); fault = undefined;
    const temporary = join(fixture.root, "target-state", "move-nodes", preview.id, "checkout");
    if (interrupted === "patches") expect(Bun.spawnSync(["git", "reset", "--hard", "HEAD"], { cwd: temporary, stdout: "ignore", stderr: "ignore" }).exitCode).toBe(0);
    rmSync(join(temporary, "later.txt"));
    expect(existsSync(fixture.target)).toBe(false); expect(fixture.counts()).toEqual({ creates: 0, launches: 0 });
    fixture.restart(); expect((await fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).phase).toBe("complete");
    expect(fixture.verifyWork()).toMatchObject({ committed: "committed\n", staged: "staged\n", working: "working\n", selected: "selected work\n" });
    expect(readFileSync(join(fixture.target, "later.txt"), "utf8")).toBe("later selected work\n");
  } finally { fault?.mockRestore(); await fixture.close(); }
});
for (const failedAt of ["destination", "journal"] as const) owned(`rejects old confirmed preview after refresh ${failedAt} failure changed the source scope`, async () => {
  const fixture = await moveFlowFixture(); let fault: ReturnType<typeof failReceipt> | undefined;
  try {
    const preview = await fixture.coordinator.moves.preview(fixture.request);
    const occupied = join(fixture.root, "occupied"); mkdirSync(occupied);
    if (failedAt === "journal") fault = failReceipt("session-moves.json");
    await expect(fixture.coordinator.moves.preview({ ...fixture.request, destination_checkout: failedAt === "destination" ? occupied : fixture.target, untracked_files: ["selected.txt", "excluded.txt"] }, preview.id)).rejects.toThrow();
    fault?.mockRestore(); fault = undefined; await fixture.exit();
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toMatchObject({ code: "source_changed" });
    expect(existsSync(fixture.target)).toBe(false); expect(fixture.counts()).toEqual({ creates: 0, launches: 0 });
    expect(fixture.flock.read().sessions[0]!.current_execution_id).toBe(fixture.request.source_execution_id);
  } finally { fault?.mockRestore(); await fixture.close(); }
});
owned("reconciles native index commit before its completion marker using exact rows, without duplicates", async () => {
  const fixture = await moveFlowFixture(undefined, { segmented: true }); let fault: ReturnType<typeof failReceipt> | undefined;
  try {
    const preview = await fixture.coordinator.moves.preview(fixture.request); await fixture.exit();
    fault = failReceipt("index-imported.json");
    await expect(fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).rejects.toThrow(); fault.mockRestore(); fault = undefined;
    const db = new Database(join(fixture.targetHome, "thread_history_1.sqlite"), { readonly: true });
    try { expect(db.query("SELECT count(*) AS n FROM thread_items WHERE thread_id = ?").get(FIXTURE_THREAD)).toEqual({ n: 1 }); } finally { db.close(); }
    expect(fixture.counts()).toEqual({ creates: 0, launches: 0 });
    fixture.restart(); expect((await fixture.coordinator.moves.run(preview.id, preview.plan.fingerprint)).phase).toBe("complete");
    const checked = new Database(join(fixture.targetHome, "thread_history_1.sqlite"), { readonly: true });
    try { expect(checked.query("SELECT count(*) AS n FROM thread_items WHERE thread_id = ?").get(FIXTURE_THREAD)).toEqual({ n: 1 }); } finally { checked.close(); }
  } finally { fault?.mockRestore(); await fixture.close(); }
});
