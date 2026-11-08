import { expect, test } from "bun:test";
import type { Machine } from "../../../shared/machines.ts";
import { flockInventory } from "../../../shared/flock-inventory.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import { tabLabelKey } from "../../lib/tabLabels.ts";
import { graphExecutionName } from "./graphNames.ts";
import { graphAppearance } from "./graphAppearance.ts";
import { graphInventory } from "./graphInventory.ts";

function roster() {
  const machine = structuredClone(fixture.machines[0]) as Machine;
  const pane = machine.snapshot!.panes.find((pane) => pane.agent === "codex")!;
  machine.snapshot!.panes = [pane]; pane.label = "codex"; pane.title = "codex"; pane.display_agent = "Codex";
  const tab = machine.snapshot!.tabs.find((tab) => tab.tab_id === pane.tab_id)!;
  const registry = { version: 1 as const, revision: 0, works: [], sessions: [], executions: [], checkouts: [] };
  return { machine, pane, tab, registry, row: flockInventory(registry, [machine])[0]! };
}
test("generic agent titles use the native custom tab name and launcher", () => {
  const { machine, row, tab } = roster(); tab.label = "Irrigation review";
  expect(graphExecutionName(row, [machine], {})).toBe("Irrigation review · Codex");
  row.session = { id: "logical", name: "Explicit logical alias", work_id: null, current_execution_id: null };
  expect(graphExecutionName(row, [machine], {})).toBe("Explicit logical alias · Codex");
});
test("numbered tabs keep native workspace context and localized tab wording", () => {
  const { machine, row, pane, tab } = roster();
  const workspace = machine.snapshot!.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)!;
  workspace.label = "infra";
  const place = machine.snapshot!.tabs.filter((item) => item.workspace_id === tab.workspace_id).indexOf(tab) + 1;
  tab.label = String(place);
  expect(graphExecutionName(row, [machine], {}, (key, vars) => key === "Tab {n}" ? `Onglet ${vars!.n}` : key)).toBe(`infra · Onglet ${place} · Codex`);
});
test("already learned automatic tab names are reused without changing metadata", () => {
  const { machine, pane, row, tab } = roster();
  const place = machine.snapshot!.tabs.filter((item) => item.workspace_id === tab.workspace_id).indexOf(tab) + 1;
  tab.label = String(place);
  const labels = { [tabLabelKey(machine.id, pane)]: "Trace the irrigation issue" }, before = JSON.stringify(machine);
  expect(graphExecutionName(row, [machine], labels)).toBe("Trace the irrigation issue · Codex");
  expect(JSON.stringify(machine)).toBe(before);
});
test("concrete checkouts deduplicate independently of branch labels and registry alias order", () => {
  const { machine, row, registry } = roster();
  row.checkout = { id: "z-observation", machine_id: machine.id, path: "/fictional/orchard/feature", repository: "/fictional/orchard", branch: "leaves" };
  const duplicate = { ...row, id: "second", checkout: { ...row.checkout, id: "a-observation", branch: "fruit" } };
  const first = graphInventory(registry, [row]), next = graphInventory(registry, [duplicate, row]);
  expect(next.nodes.filter((node) => node.kind === "checkout")).toHaveLength(1);
  expect(next.nodes.find((node) => node.kind === "checkout")!.id).toBe(first.nodes.find((node) => node.kind === "checkout")!.id);
});
test("reported repository names share colour across different machine root paths without merging nodes", () => {
  const { machine, pane, registry } = roster();
  const workspace = machine.snapshot!.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)!;
  workspace.worktree = { repo_key: "local-key", repo_name: "Orchard", repo_root: "/fictional/orchard", checkout_path: "/fictional/orchard/feature", is_linked_worktree: true };
  const remote = structuredClone(machine); remote.id = "south";
  remote.snapshot!.workspaces.find((item) => item.workspace_id === pane.workspace_id)!.worktree = { ...workspace.worktree, repo_key: "remote-key", repo_root: "/other/root/orchard", checkout_path: "/other/root/feature" };
  const graph = graphInventory(registry, flockInventory(registry, [machine, remote]), [machine, remote]), styles = graphAppearance(graph);
  const repos = graph.nodes.filter((node) => node.kind === "repository");
  expect(repos).toHaveLength(2);
  expect(repos[0]!.id).not.toBe(repos[1]!.id);
  expect(styles.get(repos[0]!.id)!.colour).toBe(styles.get(repos[1]!.id)!.colour);
  for (const execution of graph.nodes.filter((node) => node.kind === "execution")) expect(styles.get(execution.id)!.colour).toBe(styles.get(repos[0]!.id)!.colour);
});
