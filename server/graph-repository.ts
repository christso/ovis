import type { SessionSnapshot } from "../shared/protocol.ts";
import { selectGraphRemote, type GraphRepository } from "../shared/graph-repository.ts";
import { contextOf, runGit } from "./repo-diff.ts";

/** Local reads only, on graph refresh. Nothing executes a remote or emits its raw URL. */
export async function graphRepositories(snapshot: SessionSnapshot): Promise<GraphRepository[]> {
  const deadline = performance.now() + 2000;
  const git = async (cwd: string, args: string[]): Promise<string> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error("Git identity deadline reached");
    const result = await runGit(contextOf({ deadlineMs: Math.min(1000, remaining), noLazyFetch: true }), cwd, args, 64 * 1024);
    if (result.code !== 0 || result.overflow) throw new Error("Git identity unavailable");
    return result.stdout;
  };
  const paths = [...new Set(snapshot.panes.filter((pane) => !pane.restore_error && pane.cwd && pane.terminal_id).flatMap((pane) => typeof pane.cwd === "string" ? [pane.cwd] : []))];
  const evidence = new Map<string, Pick<GraphRepository, "root" | "common_directory" | "remote">>();
  for (let index = 0; index < paths.length && performance.now() < deadline; index += 4) await Promise.all(paths.slice(index, index + 4).map(async (cwd) => {
    try {
      const [common_directory, root] = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"])).trimEnd().split("\n");
      if (!common_directory || !root) return;
      let remote: string | null = null;
      try {
        const config = await git(cwd, ["config", "--includes", "--null", "--get-regexp", "^remote\\..*\\.url$"]);
        const remotes = config.split("\0").filter(Boolean).flatMap((entry) => {
          const split = entry.indexOf("\n"), key = entry.slice(0, split);
          return split > 0 ? [{ name: key.slice(7, -4), url: entry.slice(split + 1) }] : [];
        });
        const origins = remotes.filter((item) => item.name === "origin");
        const candidates = origins.length ? origins : remotes;
        if (candidates.length === 1) {
          const selected = candidates[0]!;
          const effective = await git(cwd, ["remote", "get-url", "--all", "--", selected.name]);
          remote = selectGraphRemote(effective.trimEnd().split(/\r?\n/).map((url) => ({ name: selected.name, url })));
        }
      } catch { /* no remote, unreadable or oversized config: keep local evidence only */ }
      evidence.set(cwd, { common_directory, root, remote });
    } catch { /* a non-Git folder or unavailable checkout has no repository evidence */ }
  }));
  return snapshot.panes.flatMap((pane) => {
    if (!pane.cwd) return [];
    const repository = evidence.get(pane.cwd);
    return repository && !pane.restore_error && pane.terminal_id ? [{ ...repository, pane_id: pane.pane_id, terminal_id: pane.terminal_id, cwd: pane.cwd }] : [];
  });
}
