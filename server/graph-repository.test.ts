import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import * as repoDiff from "./repo-diff.ts";
import { graphRepositories } from "./graph-repository.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ovis-graph-git-")); roots.push(root);
  const repo = join(root, "repo"), branch = join(root, "branch"), folder = join(root, "notes");
  mkdirSync(repo); mkdirSync(folder);
  git(repo, "init"); git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "Fixture");
  git(repo, "worktree", "add", "-b", "review", branch);
  const snapshot: SessionSnapshot = { protocol: 1, version: "fixture", agents: [], layouts: [], tabs: [], workspaces: [], herdr_lifetime: "fixture", panes: [repo, branch, folder].map((cwd, index) => ({ pane_id: `p${index}`, terminal_id: `t${index}`, workspace_id: `w${index}`, tab_id: `tab${index}`, agent: null, agent_status: "idle", focused: false, revision: 1, cwd })) };
  return { repo, branch, snapshot };
}
test("actual Git common directories join worktrees; sanitized origin evidence never contains credentials", async () => {
  const { repo, branch, snapshot } = fixture();
  git(repo, "remote", "add", "origin", "https://username:secret@github.com/team/orchard.git");
  git(repo, "remote", "add", "upstream", "git@github.com:other/orchard.git");
  const result = await graphRepositories(snapshot);
  expect(result).toHaveLength(2);
  expect(result.map((item) => item.root)).toEqual([repo, branch]);
  expect(result[0]!.common_directory).toBe(result[1]!.common_directory);
  expect(result.every((item) => item.remote === "https://github.com/team/orchard")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret"); expect(JSON.stringify(result)).not.toContain("username");
});
test("remote-less, ambiguous and unsupported remotes keep only local evidence; unavailable panes prove nothing", async () => {
  const { repo, snapshot } = fixture();
  expect((await graphRepositories(snapshot)).every((item) => item.remote === null)).toBe(true);
  git(repo, "remote", "add", "one", "git@github.com:team/orchard.git");
  expect((await graphRepositories(snapshot))[0]!.remote).toBe("https://github.com/team/orchard");
  git(repo, "remote", "add", "two", "git@github.com:fork/orchard.git");
  expect((await graphRepositories(snapshot)).every((item) => item.remote === null)).toBe(true);
  git(repo, "remote", "add", "origin", "file:///local/repository");
  expect((await graphRepositories(snapshot)).every((item) => item.remote === null)).toBe(true);
  snapshot.panes[0]!.restore_error = "unavailable"; snapshot.panes[1]!.terminal_id = "";
  expect(await graphRepositories(snapshot)).toEqual([]);
});

test("effective fetch URL includes Git rewrites rather than merging by an unexpanded alias", async () => {
  const { repo, snapshot } = fixture();
  git(repo, "remote", "add", "origin", "https://alias.invalid/team/orchard.git");
  git(repo, "config", "url.https://github.com/fork/.insteadOf", "https://alias.invalid/team/");
  expect((await graphRepositories(snapshot))[0]!.remote).toBe("https://github.com/fork/orchard");
});

test("slow Git discovery has a total budget and stops launching work without blocking source refresh", async () => {
  const { snapshot } = fixture();
  snapshot.panes = Array.from({ length: 40 }, (_, index) => ({ ...snapshot.panes[0]!, pane_id: `p${index}`, terminal_id: `t${index}`, cwd: `/fixture/path-${index}` }));
  const visited = new Set<string>(), started = performance.now();
  const reader = spyOn(repoDiff, "runGit").mockImplementation(async (context, cwd, args) => {
    visited.add(cwd);
    if (args[0] === "rev-parse") return { code: 0, overflow: false, stdout: `/fixture/common\n${cwd}\n` };
    // fixed wait: simulate a Git subprocess consuming its deadline to exercise the total discovery budget.
    await new Promise((resolve) => setTimeout(resolve, context.deadlineMs));
    return { code: 1, overflow: false, stdout: "" };
  });
  try {
    const result = await graphRepositories(snapshot);
    expect(visited.size).toBeLessThan(snapshot.panes.length);
    expect(performance.now() - started).toBeLessThan(6000);
    expect(result.length).toBeLessThan(snapshot.panes.length);
    expect(result.every((item) => item.remote === null)).toBe(true);
  } finally { reader.mockRestore(); }
});
