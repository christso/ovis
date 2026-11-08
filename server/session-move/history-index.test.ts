import { Database } from "bun:sqlite";
import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureHistoryIndex } from "./history-index.fixture.ts";
import { restoreHistoryIndex, snapshotHistoryIndex } from "./history-index.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ID = "019a5a00-0000-7000-8000-000000000001", OTHER = "019a5a00-0000-7000-8000-000000000002";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ovis-move-index-")); roots.push(root);
  const home = join(root, "source"), destination = join(root, "destination"); mkdirSync(home); mkdirSync(destination);
  fixtureHistoryIndex(home, ID, 100, 10); fixtureHistoryIndex(destination, "", 0, 0);
  const range = [{ id: ID, bytes: 100, required_ordinal: 10 }];
  return { home, destination, range };
}

it("copies only selected rollout rows and preserves unrelated destination history", () => {
  const { home, destination, range } = fixture();
  const source = new Database(join(home, "thread_history_1.sqlite"));
  source.query("INSERT INTO thread_items VALUES (?, 2, 'unrelated', 'must stay on source')").run(OTHER); source.close();
  const target = new Database(join(destination, "thread_history_1.sqlite"));
  target.query("INSERT INTO thread_items VALUES (?, 2, 'destination', 'must stay on destination')").run(OTHER); target.close();
  const snapshot = snapshotHistoryIndex(home, range);
  expect(JSON.stringify(snapshot)).not.toContain("must stay on source");
  restoreHistoryIndex(destination, snapshot);
  const verified = new Database(join(destination, "thread_history_1.sqlite"), { readonly: true });
  try { expect(verified.query("SELECT item_json FROM thread_items ORDER BY item_id").all()).toEqual([{ item_json: "must stay on destination" }, { item_json: "owned history" }]); }
  finally { verified.close(); }
  expect(() => restoreHistoryIndex(destination, snapshot)).toThrow("already has history");
});

it("fails on missing projection coverage and realtime artifacts", () => {
  const { home, range } = fixture();
  expect(() => snapshotHistoryIndex(home, [{ ...range[0]!, bytes: 99 }])).toThrow("does not cover");
  expect(() => snapshotHistoryIndex(home, [{ ...range[0]!, required_ordinal: 11 }])).toThrow("does not cover");
  const db = new Database(join(home, "thread_history_1.sqlite"));
  db.query("INSERT INTO thread_realtime_items VALUES (?, 'owned-audio')").run(ID); db.close();
  expect(() => snapshotHistoryIndex(home, range)).toThrow("Realtime");
});

it("rolls back the entire append on a schema mismatch, conflict or out-of-scope row", () => {
  const { home, destination, range } = fixture();
  const snapshot = snapshotHistoryIndex(home, range);
  const corrupted = structuredClone(snapshot);
  corrupted.tables[1]!.rows[0]![0] = OTHER;
  expect(() => restoreHistoryIndex(destination, corrupted)).toThrow("out-of-scope");
  const db = new Database(join(destination, "thread_history_1.sqlite"));
  expect(db.query("SELECT * FROM thread_turns").all()).toEqual([]);
  db.exec("ALTER TABLE thread_items ADD COLUMN future TEXT"); db.close();
  expect(() => restoreHistoryIndex(destination, snapshot)).toThrow("schema differs");
});

it("accepts only complete identical rows for an owned interrupted import and rejects altered rows", () => {
  const { home, destination, range } = fixture();
  const snapshot = snapshotHistoryIndex(home, range);
  restoreHistoryIndex(destination, snapshot);
  expect(() => restoreHistoryIndex(destination, snapshot, true)).not.toThrow();
  const db = new Database(join(destination, "thread_history_1.sqlite"));
  db.query("UPDATE thread_items SET item_json = 'changed independently' WHERE thread_id = ?").run(ID);
  db.close();
  expect(() => restoreHistoryIndex(destination, snapshot, true)).toThrow("differs");
  const verified = new Database(join(destination, "thread_history_1.sqlite"), { readonly: true });
  try { expect(verified.query("SELECT item_json FROM thread_items").all()).toEqual([{ item_json: "changed independently" }]); }
  finally { verified.close(); }
});
