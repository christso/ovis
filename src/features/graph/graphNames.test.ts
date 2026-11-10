import { expect, test } from "bun:test";
import type { Machine } from "../../../shared/machines.ts";
import fixture from "../../../site/demo/fixtures/machines.json";
import { tabLabelKey } from "../../lib/tabLabels.ts";
import { graphTabs } from "./graphTabs.ts";
import { graphAppearance } from "./graphAppearance.ts";

function roster() {
  const machine = structuredClone(fixture.machines[0]) as Machine;
  const pane = machine.snapshot!.panes.find((pane) => pane.agent === "codex")!;
  machine.snapshot!.panes = [pane]; pane.label = "codex"; pane.title = "codex"; pane.display_agent = "Codex";
  const tab = machine.snapshot!.tabs.find((tab) => tab.tab_id === pane.tab_id)!;
  machine.snapshot!.tabs = [tab];
  const workspace = machine.snapshot!.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)!;
  machine.snapshot!.workspaces = [workspace];
  return { machine, pane, tab, workspace };
}
test("explicit native tab names take precedence over pane and launcher titles", () => {
  const { machine, pane, tab } = roster();
  tab.label = "research"; pane.label = "Earlier eval task";
  expect(graphTabs([machine])[0]!.node.label).toBe("research");
});
test("numbered main workspace tabs keep localized workspace context", () => {
  const { machine, pane, tab, workspace } = roster();
  pane.agent = null;
  workspace.label = "infra"; delete workspace.worktree; tab.label = "1";
  expect(graphTabs([machine], {}, (key, vars) => key === "Tab {n}" ? `Onglet ${vars!.n}` : key)[0]!.node.label).toBe("infra · Onglet 1");
});
test("already learned automatic tab names are reused without changing metadata", () => {
  const { machine, pane, tab } = roster();
  tab.label = "1"; delete machine.snapshot!.workspaces[0]!.worktree;
  pane.label = ""; pane.title = "codex"; pane.terminal_title = "codex"; pane.terminal_title_stripped = "codex";
  const before = JSON.stringify(machine);
  expect(graphTabs([machine], { [tabLabelKey(machine.id, pane)]: "Trace the irrigation issue" })[0]!.node.label).toBe("Trace the irrigation issue");
  expect(JSON.stringify(machine)).toBe(before);
});
test("reported repository names share colour across machine root paths without merging tabs", () => {
  const { machine, workspace } = roster();
  workspace.worktree = { repo_key: "local-key", repo_name: "Orchard", repo_root: "/fictional/orchard", checkout_path: "/fictional/orchard/feature", is_linked_worktree: true };
  const remote = structuredClone(machine); remote.id = "south";
  remote.snapshot!.workspaces[0]!.worktree = { ...workspace.worktree, repo_key: "remote-key", repo_root: "/other/root/orchard", checkout_path: "/other/root/feature" };
  const nodes = graphTabs([machine, remote]).map((tab) => tab.node), styles = graphAppearance({ nodes, edges: [] });
  expect(nodes).toHaveLength(2);
  expect(nodes[0]!.id).not.toBe(nodes[1]!.id);
  expect(styles.get(nodes[0]!.id)!.colour).toBe(styles.get(nodes[1]!.id)!.colour);
});
