/**
 * GET /api/agents: the agent kinds this PC can start, with display labels: herdr's agent manifests,
 * Oh My Pi and Claude Code always, and the shell-started agents this server finds (shell-agent.ts).
 * The dispatcher in index.ts runs the access gate first.
 */
import { SAVED_LAUNCHER_KINDS, type SavedAgentLauncher } from "../shared/agent-launchers.ts";
import { agentExecutable } from "./agent-launchers.ts";
import { savedLaunchersSupported, type SavedLauncherStore } from "./saved-launchers.ts";
import { HerdrError } from "./herdr/client.ts";
import type { AgentKind } from "../shared/agents.ts";
import { agentManifests } from "./herdr/client.ts";
import { badRequest, errorResponse, jsonResponse, setRequestRoute } from "./http.ts";
import { SHELL_AGENTS, type ShellAgentLocator } from "./shell-agent.ts";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  omp: "Oh My Pi",
  omo: "OmO",
  gjc: "Gajae Code",
  pi: "pi",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
  kimi: "Kimi",
  amp: "Amp",
  hermes: "Hermes",
  grok: "Grok",
  agy: "Antigravity",
  devin: "Devin",
  cmd: "Command Code",
  letta: "Letta Code",
};

/**
 * The answer for the agent catalog route, or null when the path is not it. `shellAgents`: the server's
 * own locator, which starts them too. `has`: whether a kind is on a PATH a pane's shell starts it from,
 * read again once after an install put it in its installer's folder (installed-lookup.ts), so Add
 * another agent… can pick what its tile just installed; without it, the locator and this server's PATH.
 */
export async function handleAgentsRequest(request: Request, pathname: string, shellAgents: Pick<ShellAgentLocator, "executable">, savedLaunchers?: SavedLauncherStore, has?: (kind: string) => Promise<boolean>): Promise<Response | null> {
  if (pathname === "/api/agents") {
    setRequestRoute(pathname);
    if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
    try {
      const canSaveLaunchers = savedLaunchers !== undefined && savedLaunchersSupported();
      let saved: SavedAgentLauncher[] = [];
      try { if (canSaveLaunchers) saved = savedLaunchers.get(); }
      catch (error) { if (!(error instanceof HerdrError) || error.code !== "launcher_store_unavailable") throw error; }
      const kinds = new Set((await agentManifests()).manifests.map((manifest) => manifest.agent));
      if (canSaveLaunchers) for (const kind of SAVED_LAUNCHER_KINDS) kinds.add(kind);
      kinds.add("omp");
      kinds.add("claude");
      // not herdr kinds: offered where this server can run them (see shell-agent.ts), with the locator
      // the start asks too, so what is offered is what starts
      const shellStarted = new Set<string>();
      for (const kind of Object.keys(SHELL_AGENTS)) if (has !== undefined ? await has(kind) : (await shellAgents.executable(kind)) !== null) shellStarted.add(kind);
      for (const kind of shellStarted) kinds.add(kind);
      // an agent's command is its kind; herdr starts the others in the pane's shell, whose PATH is the
      // login shell's: this server's PATH speaks first, then the login PATH
      const installed = async (kind: string): Promise<boolean> =>
        shellStarted.has(kind) || agentExecutable(kind) !== null || (has !== undefined && await has(kind));
      const agents: AgentKind[] = (await Promise.all([...kinds].map(async (kind) => ({ kind, label: AGENT_LABELS[kind] ?? kind, installed: await installed(kind),
        ...(canSaveLaunchers && SAVED_LAUNCHER_KINDS.includes(kind) ? { saved_launchers: true, launcher_search: true } : {}),
        ...(saved.some(entry => entry.kind === kind) ? { launchers: saved.filter(entry => entry.kind === kind).map(({ id, label }) => ({ id, label })) } : {}) }))))
        .sort((left, right) => left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind));
      return jsonResponse({ agents });
    } catch (error) {
      return errorResponse(error);
    }
  }
  return null;
}
