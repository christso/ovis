import { expect, it } from "bun:test";
import type { FlockRow } from "../../shared/flock-inventory.ts";
import { flockTableRows } from "./flockTable.ts";
const row = (id: string, name: string, machine: string): FlockRow => ({ id, name, machine_id: machine, machine_name: machine, session: null, work: null, execution: null, checkout: null, binding: null, pane: null, availability: "unavailable", status: "unavailable" });
it("filters across machines and sorts without inferring identity from equal names", () => {
  const rows = [row("b", "Second", "two"), row("c", "First", "two"), row("a", "First", "one")];
  expect(flockTableRows(rows, "", "", "name", false).map((row) => row.id)).toEqual(["a", "c", "b"]);
  expect(flockTableRows(rows, "first TWO", "", "name", true).map((row) => row.id)).toEqual(["c"]);
  expect(flockTableRows(rows, "", "one", "name", false).map((row) => row.id)).toEqual(["a"]);
  expect(rows.map((row) => row.id)).toEqual(["b", "c", "a"]);
});
