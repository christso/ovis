import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/herdr-api.generated.ts";
import * as herdr from "./herdr/client.ts";
import { observePeerDisplayName, peerDisplayName } from "./message-source-name.ts";

const source = { server_id: "fictional-server", boot_id: "boot", terminal_id: "terminal", agent_instance_id: "process", pane_id: "w1:p1", agent: "codex", name: "kebab-case-registration" };
const fixture = () => ({ panes: [{ pane_id: source.pane_id, terminal_id: source.terminal_id, agent: "codex", label: null, title: "codex", tab_id: "w1:t1", workspace_id: "w1" }], tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "1", number: 1 }] }) as SessionSnapshot;
const labels = { "w1:p1|terminal": "Graph worktree projection", "remote:other:w1%3Ap1|terminal": "Other PC" };

it("uses source pane, tab, meaningful Ovis title, shared label, registration, then kind", () => {
  const snapshot = fixture(), pane = snapshot.panes[0]!, tab = snapshot.tabs[0]!;
  expect(peerDisplayName(snapshot, source, labels)).toBe("Graph worktree projection");
  pane.title = "Review release | project";
  expect(peerDisplayName(snapshot, source, labels)).toBe("Review release");
  tab.label = "Release coordinator";
  expect(peerDisplayName(snapshot, source, labels)).toBe("Release coordinator");
  pane.label = "Graph worktree projection";
  expect(peerDisplayName(snapshot, source, labels)).toBe("Graph worktree projection");
  pane.label = null; tab.label = "1"; pane.title = "codex";
  expect(peerDisplayName(snapshot, source, labels, false)).toBe(source.name);
  expect(peerDisplayName(snapshot, source, { "w1:p1|old-terminal": "Stale", "remote:other:w1%3Ap1|terminal": "Other PC" })).toBe(source.name);
  expect(peerDisplayName(snapshot, { ...source, name: null })).toBe("codex");
  pane.label = "/private/work/repo"; tab.label = "ssh://private-host/work";
  expect(peerDisplayName(snapshot, source, labels)).toBe("Graph worktree projection");
  for (const label of ["Review(ssh://private-host/work)", "Review(/private/work/repo)", "Review[C:\\private\\work]", "Review(~/private/work)", "./private/project", "../private/project", "Review private/work/repo"]) {
    pane.label = label;
    expect(peerDisplayName(snapshot, source, labels)).toBe("Graph worktree projection");
  }
  pane.terminal_id = "replacement";
  expect(peerDisplayName(snapshot, source, labels)).toBeUndefined();
});

it("reads shared display labels offline without changing state, and honors the disabled setting", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-display-"));
  const snapshot = spyOn(herdr, "sessionSnapshot").mockResolvedValue(fixture());
  try {
    writeFileSync(join(root, "tab-labels.json"), JSON.stringify({ tab_labels: labels }));
    expect(await observePeerDisplayName("fictional-socket", source, root)).toBe("Graph worktree projection");
    writeFileSync(join(root, "preferences.json"), JSON.stringify({ settings: { autoTabNames: false } }));
    expect(await observePeerDisplayName("fictional-socket", source, root)).toBe(source.name);
    writeFileSync(join(root, "tab-labels.json"), "{malformed");
    expect(await observePeerDisplayName("fictional-socket", source, root)).toBe(source.name);
  } finally { snapshot.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
