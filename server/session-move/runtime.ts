import { existsSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { agentLaunch } from "../agent-launch.ts";
import { codexTranscriptPath, defaultCodexHome, paneCodexHomePlaced, paneCodexProcess } from "../codex.ts";
import { sessionSnapshot, workspaceCreate } from "../herdr/client.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import { MoveRefused, readMoveFile } from "./files.ts";
import { NativeMoveClient } from "./native.ts";
import type { MoveNodeRuntime } from "./node.ts";

export function moveRuntime(snapshot: () => Promise<SessionSnapshot>, configuredHome?: string): MoveNodeRuntime {
  const native = async (home: string, proxy: boolean) => {
    if (proxy) { try { return await NativeMoveClient.open(home, "proxy"); } catch (error) { if (error instanceof MoveRefused && ["codex_incompatible", "native_home_mismatch"].includes(error.code)) throw error; } }
    return NativeMoveClient.open(home, "stdio");
  };
  return {
    async capabilities(observedHome) {
      const probe = Bun.spawnSync(["codex", "--version"], { stdout: "pipe", stderr: "ignore" });
      const version = /^codex-cli (\S+)/.exec(probe.stdout.toString())?.[1] ?? "unknown";
      const named = observedHome ?? configuredHome ?? defaultCodexHome();
      if (!existsSync(named)) return { version, platform: process.platform, native_resume: false, authenticated: false, home: named };
      const home = realpathSync(named);
      if (version !== "0.166.0") return { version, platform: process.platform, native_resume: false, authenticated: false, home };
      const client = await native(home, true);
      try {
        const account = await client.call("account/read", { refreshToken: false }) as { account?: unknown; requiresOpenaiAuth?: boolean };
        return { version, platform: process.platform, native_resume: true, authenticated: account.account !== null && account.account !== undefined || account.requiresOpenaiAuth === false, home };
      } finally { await client.close(); }
    },
    async observe(paneId, threadId, lifetime) {
      const current = await snapshot(), pane = current.panes.find((pane) => pane.pane_id === paneId);
      if (current.herdr_lifetime !== lifetime || pane?.agent !== "codex" || pane.restore_error || !pane.cwd) throw new MoveRefused("source_changed", "The source execution no longer matches the selected session");
      if (pane.agent_status !== "idle" && pane.agent_status !== "done") throw new MoveRefused("source_busy", "Let the active Codex turn finish before previewing its transfer");
      const sourceProcess = await paneCodexProcess(paneId);
      if (!sourceProcess) throw new MoveRefused("source_store_unknown", "Preview while this native Codex client is still open");
      let executable = sourceProcess.argv?.[0];
      if (process.platform === "linux") executable = readlinkSync(`/proc/${sourceProcess.pid}/exe`);
      if (!executable || !isAbsolute(executable) || Bun.spawnSync([executable, "--version"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim() !== "codex-cli 0.166.0") throw new MoveRefused("codex_incompatible", "The source process must be the supported Codex 0.166.0 runtime");
      const repository = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: pane.cwd, stdout: "pipe", stderr: "ignore" });
      if (repository.exitCode !== 0 || realpathSync(repository.stdout.toString().trim()) !== realpathSync(pane.cwd)) throw new MoveRefused("unsupported_checkout", "Move sessions whose native working directory is the Git checkout root");
      const located = await paneCodexHomePlaced(paneId);
      if (!located.placed) throw new MoveRefused("source_store_unknown", "The selected native Codex store cannot be proven");
      const home = realpathSync(located.home), path = await codexTranscriptPath(paneId, pane.cwd, home, current.panes);
      if (!path) throw new MoveRefused("source_store_unknown", "The selected native rollout cannot be proven");
      const rollout = relative(home, path).split("\\").join("/");
      const first = JSON.parse(readMoveFile(home, rollout).data.toString().split("\n")[0]!);
      if (first.payload?.id !== threadId || first.payload?.cwd !== pane.cwd) throw new MoveRefused("source_changed", "The selected native rollout does not match the source checkout");
      return { home, rollout, cwd: realpathSync(pane.cwd), thread_id: threadId, lifetime, pane_id: paneId };
    },
    native,
    async create(cwd, home, label) {
      const created = await workspaceCreate({ cwd, label, env: { CODEX_HOME: home } });
      const current = await snapshot();
      if (!current.herdr_lifetime) throw new MoveRefused("destination_unproven", "Destination lifetime cannot be proven");
      return { pane_id: created.root_pane.pane_id, lifetime: current.herdr_lifetime };
    },
    async find(label, cwd) {
      const current = await snapshot(), workspaces = current.workspaces.filter((workspace) => workspace.label === label);
      if (workspaces.length > 1) throw new MoveRefused("reconciliation_required", "More than one workspace matches this transfer receipt");
      const pane = current.panes.find((pane) => pane.workspace_id === workspaces[0]?.workspace_id && pane.cwd === cwd);
      return pane && current.herdr_lifetime ? { pane_id: pane.pane_id, lifetime: current.herdr_lifetime } : null;
    },
    async start(paneId, threadId) {
      const launched = await agentLaunch(paneId, { kind: "codex", args: ["resume", threadId] });
      if (!launched.agent_started) throw new MoveRefused("destination_start_failed", "The destination could not start native Codex resume");
    },
    async paneSession(paneId, threadId, lifetime, home) {
      const current = await snapshot(), pane = current.panes.find((pane) => pane.pane_id === paneId);
      if (current.herdr_lifetime !== lifetime || pane?.agent !== "codex" || !pane.cwd) return false;
      const located = await paneCodexHomePlaced(paneId);
      if (!located.placed || realpathSync(located.home) !== home) return false;
      const path = await codexTranscriptPath(paneId, pane.cwd, home, current.panes);
      if (!path) return false;
      const meta = JSON.parse(readMoveFile(home, relative(home, path).split("\\").join("/")).data.toString().split("\n")[0]!);
      return meta.payload?.id === threadId;
    },
  };
}

export const localMoveRuntime = (home?: string): MoveNodeRuntime => moveRuntime(sessionSnapshot, home);
