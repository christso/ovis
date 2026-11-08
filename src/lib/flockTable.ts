import type { FlockRow } from "../../shared/flock-inventory.ts";

export type FlockColumn = "name" | "work" | "repository" | "branch" | "status" | "machine";
export function flockColumn(row: FlockRow, column: FlockColumn): string {
  switch (column) {
    case "name": return row.name;
    case "work": return row.work?.name ?? "";
    case "repository": return row.checkout?.repository ?? "";
    case "branch": return row.checkout?.branch ?? "";
    case "status": return row.status;
    case "machine": return row.machine_name;
  }
}
export function flockTableRows(rows: readonly FlockRow[], query: string, machineId: string, column: FlockColumn, descending: boolean): FlockRow[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (machineId && row.machine_id !== machineId) return false;
    const haystack = [row.name, row.work?.name, row.checkout?.repository, row.checkout?.branch, row.checkout?.path, row.machine_name, row.status, row.binding?.native_session_id, row.execution?.id, row.session?.id].filter(Boolean).join("\n").toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  }).sort((a, b) => (descending ? -1 : 1) * flockColumn(a, column).localeCompare(flockColumn(b, column)) || a.id.localeCompare(b.id));
}
