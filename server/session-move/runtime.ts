import { existsSync, realpathSync } from "node:fs";
import { relative } from "node:path";
import { agentLaunch } from "../agent-launch.ts";
import { codexTranscriptPath, defaultCodexHome, paneCodexHomePlaced } from "../codex.ts";
import { sessionSnapshot, workspaceCreate } from "../herdr/client.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import { MoveRefused, readMoveFile } from "./files.ts";
import { NativeMoveClient } from "./native.ts";
import type { MoveNodeRuntime } from "./node.ts";

export function moveRuntime(snapshot: () => Promise<SessionSnapshot>, configuredHome?: string): MoveNodeRuntime {
  const native = async (home: string, proxy: boolean) => {
    if (proxy) { try { return await NativeMoveClient.open(home, "proxy"); } catch { /* stopped clients can leave no daemon; stdio only reads native history */ } }
    return NativeMoveClient.open(home, "stdio");
  };
  return {
    async capabilities() {
      const probe = Bun.spawnSync(["codex", "--version"], { stdout: "pipe", stderr: "ignore" });
      const version = /^codex-cli (\S+)/.exec(probe.stdout.toString())?.[1] ?? "unknown";
      const named = configuredHome ?? defaultCodexHome();
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
      if (current.herdr_lifetime !== lifetime || pane?.agent !== "codex" || pane.agent_session?.kind !== "id" || pane.agent_session.value !== threadId || pane.restore_error || !pane.cwd) throw new MoveRefused("source_changed", "The source execution no longer matches the selected session");
      if (pane.agent_status !== "idle" && pane.agent_status !== "waiting" && pane.agent_status !== "completed") throw new MoveRefused("source_busy", "Let the active Codex turn finish before previewing its transfer");
      const located = await paneCodexHomePlaced(paneId, configuredHome);
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
    async paneSession(paneId, threadId, lifetime) {
      const current = await snapshot(), pane = current.panes.find((pane) => pane.pane_id === paneId);
      return current.herdr_lifetime === lifetime && pane?.agent === "codex" && pane.agent_session?.kind === "id" && pane.agent_session.value === threadId;
    },
  };
}

export const localMoveRuntime = (home?: string): MoveNodeRuntime => moveRuntime(sessionSnapshot, home);
