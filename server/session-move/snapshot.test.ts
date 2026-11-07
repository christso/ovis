import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreCheckout, snapshotCheckout } from "./checkout.ts";
import { codexCompatibility, restoreCodex, snapshotCodex } from "./codex.ts";
import { fixtureHistoryIndex } from "./history-index.fixture.ts";
import { digest, MoveRefused } from "./files.ts";
import { holdQuiescentCodex } from "./quiescence.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = () => { const root = mkdtempSync(join(tmpdir(), "ovis-move-")); roots.push(root); return root; };
const directory = (root: string, name: string): string => { const path = join(root, name); mkdirSync(path, { recursive: true }); return path; };
const THREAD = "019a5a00-0000-7000-8000-000000000001";
const REVERT = "019a5a00-0000-7000-8000-000000000002";
const TAIL = "019a5a00-0000-7000-8000-000000000003";
const name = (id: string) => `sessions/2026/11/07/rollout-2026-11-07T01-00-00-${id}.jsonl`;
const line = (value: unknown): string => JSON.stringify(value) + "\n";
const meta = (cwd: string, ordinal = 0, extra = {}) => ({ timestamp: "2026-11-07T01:00:00Z", ordinal, type: "session_meta", payload: { id: THREAD, session_id: THREAD, cwd, cli_version: "0.166.0", source: "cli", history_mode: "paginated", ...extra } });
const put = (home: string, path: string, text: string): void => { directory(home, "sessions/2026/11/07"); writeFileSync(join(home, path), text); };
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" } });
  if (result.exitCode) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}
function repo(root: string): string {
  const source = directory(root, "source"); git(source, "init", "--template=");
  writeFileSync(join(source, "file.txt"), "original\n"); writeFileSync(join(source, "binary"), Buffer.from([0, 1, 2]));
  git(source, "add", "."); git(source, "commit", "-m", "Owned fixture"); return source;
}

describe("checkout snapshots", () => {
  it("restores commits, binary work, staged and unstaged edits and only selected untracked files", () => {
    const root = fixture(), source = repo(root), staging = directory(root, "snapshot"), destination = join(root, "destination");
    writeFileSync(join(source, "file.txt"), "staged\n"); git(source, "add", "file.txt");
    writeFileSync(join(source, "file.txt"), "working\n"); writeFileSync(join(source, "binary"), Buffer.from([0, 255, 2, 3]));
    writeFileSync(join(source, "chosen.txt"), "owned work\n"); writeFileSync(join(source, "leave.txt"), "excluded\n");
    const snapshot = snapshotCheckout(source, staging, ["chosen.txt"]);
    expect(snapshot.excluded_untracked).toEqual(["leave.txt"]);
    restoreCheckout(snapshot, staging, destination);
    expect(git(destination, "rev-parse", "HEAD")).toBe(git(source, "rev-parse", "HEAD"));
    expect(git(destination, "show", ":file.txt")).toBe("staged\n");
    expect(readFileSync(join(destination, "file.txt"), "utf8")).toBe("working\n");
    expect([...readFileSync(join(destination, "binary"))]).toEqual([0, 255, 2, 3]);
    expect(readFileSync(join(destination, "chosen.txt"), "utf8")).toBe("owned work\n");
    expect(existsSync(join(destination, "leave.txt"))).toBe(false);
    expect(git(destination, "remote")).toBe("");
    expect(readFileSync(join(source, "leave.txt"), "utf8")).toBe("excluded\n");
  });
  it("rejects destination conflicts and corruption before creating a checkout", () => {
    const root = fixture(), source = repo(root), staging = directory(root, "snapshot");
    const snapshot = snapshotCheckout(source, staging, []);
    expect(() => restoreCheckout(snapshot, staging, source)).toThrow("already exists");
    writeFileSync(join(staging, "commits.bundle"), "tampered");
    expect(() => restoreCheckout(snapshot, staging, join(root, "destination"))).toThrow("checksum");
    expect(existsSync(join(root, "destination"))).toBe(false);
  });
  it("does not accept ignored or unlisted untracked scopes", () => {
    const root = fixture(), source = repo(root), staging = directory(root, "snapshot");
    writeFileSync(join(source, ".gitignore"), "secret\n"); writeFileSync(join(source, "secret"), "owned fixture secret");
    expect(() => snapshotCheckout(source, staging, ["secret"])).toThrow("non-ignored");
    expect(() => snapshotCheckout(source, staging, ["../escape"])).toThrow(MoveRefused);
  });
});

describe("native Codex artifact closure", () => {
  it("preserves segmented/reverted lineage byte offsets, with gaps in native record ordinals", () => {
    const root = fixture(), home = directory(root, "source-home"), cwd = directory(root, "checkout"), staging = directory(root, "snapshot"), dest = directory(root, "destination-home");
    const prefix = line(meta(cwd)) + line({ ordinal: 9, type: "event_msg", payload: { type: "agent_message", message: "inherited" } });
    put(home, name(`${THREAD}_${REVERT}`), prefix + line({ ordinal: 10, type: "event_msg", payload: { type: "agent_message", message: "discarded" } }));
    const path = name(`${THREAD}_${TAIL}`);
    put(home, path, line(meta(cwd, 10, { history_base: { thread_id: REVERT, end_ordinal_exclusive: 10, end_byte_offset: Buffer.byteLength(prefix) } })) + line({ ordinal: 11, type: "event_msg", payload: { type: "agent_message", message: "continued" } }));
    writeFileSync(join(home, "auth.json"), "do not transfer fixture credentials");
    fixtureHistoryIndex(home, REVERT, Buffer.byteLength(prefix), 10);
    const snapshot = snapshotCodex(home, path, THREAD, staging);
    expect(snapshot.files).toHaveLength(2);
    expect(snapshot.files[0]!.sha256).toBe(digest(readFileSync(join(home, name(`${THREAD}_${REVERT}`)))));
    restoreCodex(snapshot, staging, dest, join(root, "relocated"));
    expect(readFileSync(join(dest, name(`${THREAD}_${REVERT}`)), "utf8")).toBe(readFileSync(join(home, name(`${THREAD}_${REVERT}`)), "utf8"));
    expect(existsSync(join(dest, "auth.json"))).toBe(false);
    expect(readFileSync(join(home, name(`${THREAD}_${REVERT}`)), "utf8")).toContain("discarded");
  });
  it("rejects missing/cyclic lineage, incomplete bytes and incorrect cut ordinals", () => {
    const root = fixture(), home = directory(root, "home"), cwd = directory(root, "checkout"), staging = directory(root, "snapshot");
    put(home, name(THREAD), line(meta(cwd, 5, { history_base: { thread_id: REVERT, end_ordinal_exclusive: 5, end_byte_offset: 1 } })));
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("missing or ambiguous");
    put(home, name(THREAD), line(meta(cwd)).trimEnd());
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("incomplete final record");
    const prefix = line(meta(cwd)); put(home, name(`${THREAD}_${REVERT}`), prefix);
    put(home, name(THREAD), line(meta(cwd, 5, { history_base: { thread_id: REVERT, end_ordinal_exclusive: 5, end_byte_offset: Buffer.byteLength(prefix) } })));
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("ordinal boundary");
  });
  it("collects checkout images, refuses path relocation with external native image references", () => {
    const root = fixture(), home = directory(root, "home"), cwd = directory(root, "checkout"), staging = directory(root, "snapshot"), dest = directory(root, "dest");
    writeFileSync(join(cwd, "picture.png"), "fixture image bytes");
    put(home, name(THREAD), line(meta(cwd)) + line({ ordinal: 1, type: "event_msg", payload: { local_images: [join(cwd, "picture.png")] } }));
    const snapshot = snapshotCodex(home, name(THREAD), THREAD, staging);
    expect(snapshot.checkout_artifacts).toEqual(["picture.png"]);
    expect(() => restoreCodex(snapshot, staging, dest, "/another/checkout")).toThrow("same absolute");
    expect(existsSync(join(dest, "sessions"))).toBe(false);
  });
  it("refuses file attachments, subagents, and traversal without writing any snapshot files", () => {
    const root = fixture(), home = directory(root, "home"), cwd = directory(root, "checkout"), staging = directory(root, "snapshot");
    put(home, name(THREAD), line(meta(cwd)) + line({ ordinal: 1, type: "response_item", payload: { type: "input_file", file_id: "file_owned_fixture" } }));
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("attachments");
    put(home, name(THREAD), line(meta(cwd, 0, { parent_thread_id: REVERT })));
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("Subagents");
    expect(() => snapshotCodex(home, "sessions/../auth.json", THREAD, staging)).toThrow(MoveRefused);
  });
  it.skipIf(process.platform === "win32")("never follows symbolic links out of either store", () => {
    const root = fixture(), home = directory(root, "home"), cwd = directory(root, "checkout"), staging = directory(root, "snapshot");
    put(home, name(THREAD), line(meta(cwd)));
    symlinkSync(cwd, join(home, "sessions", "escape"));
    expect(() => snapshotCodex(home, name(THREAD), THREAD, staging)).toThrow("symbolic link");
  });
  it("fails compatibility before touching the source", () => {
    const runtime = { version: "0.166.0", platform: "linux", native_resume: true, authenticated: true };
    expect(() => codexCompatibility(runtime, runtime)).not.toThrow();
    expect(() => codexCompatibility(runtime, { ...runtime, version: "0.167.0" })).toThrow("0.166.0");
    expect(() => codexCompatibility(runtime, { ...runtime, authenticated: false })).toThrow("Sign in");
    expect(() => codexCompatibility(runtime, { ...runtime, platform: "win32" })).toThrow("Linux or macOS");
  });
});

it.skipIf(!["linux", "darwin"].includes(process.platform))("holds only its chosen native thread writer lock until release", () => {
  const root = fixture(), home = directory(root, "home");
  const held = holdQuiescentCodex(home, THREAD);
  try {
    expect(() => holdQuiescentCodex(home, THREAD)).toThrow("native Codex client");
    const other = holdQuiescentCodex(home, REVERT); other.release();
    held.assertHeld();
  } finally { held.release(); }
  expect(() => held.assertHeld()).toThrow("re-established");
  const again = holdQuiescentCodex(home, THREAD); again.release();
});
