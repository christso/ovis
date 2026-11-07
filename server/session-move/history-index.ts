import { constants as sqliteConstants, Database } from "bun:sqlite";
import { digest, inside, MAX_MOVE_BYTES, MoveRefused } from "./files.ts";

const TABLES = ["thread_turns", "thread_items", "thread_history_projection_state"] as const;
type Cell = string | number | null;
interface TableRows { table: typeof TABLES[number]; columns: string[]; rows: Cell[][] }
export interface CodexHistoryIndex { version: 1; schema: string; rollout_ids: string[]; tables: TableRows[] }

function schema(db: Database): string {
  const migrations = db.query("SELECT version, hex(checksum) AS checksum, success FROM _sqlx_migrations ORDER BY version").all() as { version: number; checksum: string; success: number }[];
  if (migrations.length !== 8 || migrations.some((item, index) => item.version !== index + 1 || item.success !== 1)) throw new MoveRefused("unsupported_history_index", "Codex history index migrations differ from 0.166.0");
  const definitions = db.query("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return digest(Buffer.from(JSON.stringify({ migrations, definitions })));
}

/** Export only cache rows keyed by the exact native rollout IDs in the selected lineage. */
export function snapshotHistoryIndex(home: string, ranges: readonly { id: string; bytes: number; required_ordinal: number }[]): CodexHistoryIndex {
  if (!ranges.length || ranges.some((range) => !/^[a-f0-9-]{36}$/.test(range.id))) throw new MoveRefused("invalid_history_index", "Invalid native history lineage");
  const db = new Database(inside(home, "thread_history_1.sqlite"), { readonly: true, create: false });
  try {
    return db.transaction(() => {
      const fingerprint = schema(db), ids = ranges.map((range) => range.id);
      const parameters = ids.map(() => "?").join(",");
      const realtime = db.query(`SELECT 1 FROM thread_realtime_items WHERE thread_id IN (${parameters}) LIMIT 1`).get(...ids);
      if (realtime) throw new MoveRefused("unsupported_artifact", "Realtime session artifacts require a separate native export");
      const tables: TableRows[] = TABLES.map((table) => {
        const rows = db.query(`SELECT * FROM ${table} WHERE thread_id IN (${parameters}) ORDER BY thread_id, ${table === "thread_history_projection_state" ? "next_rollout_ordinal" : "rollout_ordinal"}`).all(...ids) as Record<string, Cell>[];
        const columns = (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((item) => item.name);
        if (columns.some((name) => !/^[a-z_]+$/.test(name))) throw new MoveRefused("unsupported_history_index", "Codex history index has unsupported columns");
        return { table, columns, rows: rows.map((row) => columns.map((name) => row[name]!)) };
      });
      const states = tables.find((table) => table.table === "thread_history_projection_state")!;
      for (const range of ranges) {
        const row = states.rows.find((row) => row[states.columns.indexOf("thread_id")] === range.id);
        if (!row || (row[states.columns.indexOf("next_rollout_byte_offset")] as number) > range.bytes
          || (row[states.columns.indexOf("next_rollout_ordinal")] as number) < range.required_ordinal) throw new MoveRefused("incomplete_history_index", "Codex inherited history index is missing or does not cover the required records");
      }
      const result: CodexHistoryIndex = { version: 1, schema: fingerprint, rollout_ids: ids, tables };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_MOVE_BYTES) throw new MoveRefused("snapshot_too_large", "Codex history index exceeds the transfer limit");
      return result;
    })();
  } finally { db.close(); }
}

/** The installed destination CLI initializes its schema first. Append selected cache rows atomically; never replace existing rows. */
export function restoreHistoryIndex(home: string, snapshot: CodexHistoryIndex, acceptIdentical = false): void {
  if (snapshot.version !== 1 || snapshot.tables.length !== TABLES.length || new Set(snapshot.tables.map((item) => item.table)).size !== TABLES.length
    || snapshot.tables.some((item) => !TABLES.includes(item.table) || item.columns.some((name) => !/^[a-z_]+$/.test(name)))) throw new MoveRefused("unsupported_history_index", "Unsupported Codex history index snapshot");
  const db = new Database(inside(home, "thread_history_1.sqlite"), sqliteConstants.SQLITE_OPEN_READWRITE);
  try {
    db.transaction(() => {
      if (schema(db) !== snapshot.schema) throw new MoveRefused("unsupported_history_index", "Destination Codex history schema differs from the source");
      for (const table of snapshot.tables) {
        const columns = (db.query(`PRAGMA table_info(${table.table})`).all() as { name: string }[]).map((item) => item.name);
        if (JSON.stringify(columns) !== JSON.stringify(table.columns)) throw new MoveRefused("unsupported_history_index", "Codex history columns differ from the source");
        const placeholders = snapshot.rollout_ids.map(() => "?").join(",");
        const existing = db.query(`SELECT * FROM ${table.table} WHERE thread_id IN (${placeholders}) ORDER BY thread_id, ${table.table === "thread_history_projection_state" ? "next_rollout_ordinal" : "rollout_ordinal"}`).all(...snapshot.rollout_ids) as Record<string, Cell>[];
        if (existing.length) {
          if (!acceptIdentical || JSON.stringify(existing.map((row) => columns.map((column) => row[column]))) !== JSON.stringify(table.rows)) throw new MoveRefused("destination_conflict", "Destination already has history that differs or is not owned by this transfer");
          continue;
        }
        const insert = db.query(`INSERT INTO ${table.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
        const threadColumn = columns.indexOf("thread_id");
        for (const row of table.rows) {
          if (row.length !== columns.length || !snapshot.rollout_ids.includes(row[threadColumn] as string)
            || row.some((cell) => cell !== null && typeof cell !== "string" && (typeof cell !== "number" || !Number.isSafeInteger(cell)))) throw new MoveRefused("invalid_history_index", "Codex history contains an invalid or out-of-scope row");
          insert.run(...row);
        }
      }
    }).immediate();
  } finally { db.close(); }
}
