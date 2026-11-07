/** Minimal owned index for unit tests. Installed native schema qualification lives in native.contract.test.ts. */
import { Database } from "bun:sqlite";
import { join } from "node:path";

export function fixtureHistoryIndex(home: string, id: string, bytes: number, ordinal: number): void {
  const db = new Database(join(home, "thread_history_1.sqlite"));
  try {
    db.exec(`CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, checksum BLOB, success INTEGER);
      CREATE TABLE thread_turns (thread_id TEXT, rollout_ordinal INTEGER, turn_id TEXT, PRIMARY KEY(thread_id, turn_id));
      CREATE TABLE thread_items (thread_id TEXT, rollout_ordinal INTEGER, item_id TEXT, item_json TEXT, PRIMARY KEY(thread_id, item_id));
      CREATE TABLE thread_history_projection_state (thread_id TEXT PRIMARY KEY, next_rollout_byte_offset INTEGER, next_rollout_ordinal INTEGER);
      CREATE TABLE thread_realtime_items (thread_id TEXT, item_id TEXT);`);
    for (let version = 1; version <= 8; version++) db.query("INSERT INTO _sqlx_migrations VALUES (?, NULL, 1)").run(version);
    if (id) {
      db.query("INSERT INTO thread_turns VALUES (?, 1, 'owned-turn')").run(id);
      db.query("INSERT INTO thread_items VALUES (?, 2, 'owned-message', 'owned history')").run(id);
      db.query("INSERT INTO thread_history_projection_state VALUES (?, ?, ?)").run(id, bytes, ordinal);
    }
  } finally { db.close(); }
}
