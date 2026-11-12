import { HERDR_SHIM_REVISION } from "../shared/communication-tracking.ts";
/** User-owned, opt-in shell setup for the standalone CLI observer. Never changes the daemon. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { CommunicationTrackingSetupRequest, CommunicationTrackingStatus } from "../shared/communication-tracking.ts";
import { sysctlCall } from "./darwin-process.ts";
import { defaultStateDir } from "./update-state.ts";
import { herdrCliDirectory } from "./herdr/cli-observations.ts";
import { herdrCliLauncher } from "./herdr/cli-launcher.ts";
import { paneProcessInfo, sessionSnapshot } from "./herdr/client.ts";
import { capabilities } from "./runtime/capabilities.ts";
import { herdrConfigPath, readHerdrConfig } from "./herdr-sidebar.ts";
import { shellQuote } from "./machine-security.ts";
import { acquireOwnerDirectory } from "./owner-guard.ts";
import { badRequest, errorResponse, jsonResponse, readJsonObject, setRequestRoute } from "./http.ts";

export const COMMUNICATION_TRACKING_PATH = "/api/agents/communication-tracking";

export interface CommunicationTrackingService {
  status(): Promise<CommunicationTrackingStatus>;
  enable(expected?: CommunicationTrackingSetupRequest): Promise<CommunicationTrackingStatus>;
  disable(): Promise<CommunicationTrackingStatus>;
}

export class CommunicationTrackingSetupChanged extends Error {
  readonly code = "setup_changed";
  constructor() { super("The shell setup changed since confirmation. Check the setup and confirm again."); }
}

/** The dispatcher enforces owner, watch, origin and explicit-app-header checks before this route. */
export async function handleCommunicationTrackingRequest(request: Request, service: CommunicationTrackingService, canManage: boolean, local = true): Promise<Response> {
  setRequestRoute(COMMUNICATION_TRACKING_PATH);
  if (new URL(request.url).search) return badRequest("invalid_query", "Communication tracking takes no query");
  if (!["GET", "POST", "DELETE"].includes(request.method)) return badRequest("method_not_allowed", "use GET, POST or DELETE");
  if (!local) return jsonResponse({ state: "unsupported", shell: null, profiles: [], detail: "Communication tracking must be configured on the PC that runs these terminals.", can_manage: false } satisfies CommunicationTrackingStatus, 200, { "cache-control": "no-store" });
  let expected: CommunicationTrackingSetupRequest | undefined;
  if (request.method === "POST") {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    if (Object.keys(body).some((key) => key !== "shell" && key !== "profiles") || (body["shell"] !== null && typeof body["shell"] !== "string")
      || !Array.isArray(body["profiles"]) || body["profiles"].length > 4 || !body["profiles"].every((path: unknown) => typeof path === "string" && path.length <= 4096)) return badRequest("invalid_body", "Confirm the shell and profiles returned by communication tracking status");
    expected = { shell: body["shell"] as string | null, profiles: body["profiles"] as string[] };
  }
  try {
    const status = await (request.method === "POST" ? service.enable(expected) : request.method === "DELETE" ? service.disable() : service.status());
    return jsonResponse({ ...status, can_manage: status.can_manage && canManage }, 200, { "cache-control": "no-store" });
  } catch (error) {
    if (error instanceof CommunicationTrackingSetupChanged) return jsonResponse({ error: { code: error.code, message: error.message } }, 409);
    return errorResponse(new Error("Communication tracking setup is unavailable or another setup is in progress"));
  }
}
interface Options {
  stateDir?: string;
  home?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  configPath?: string;
  directory?: string;
}
interface Profile { path: string; target: string; block: string; created: boolean }
interface Setup {
  version: 1;
  owner: "ovis-communication-tracking";
  real: string;
  shell: string;
  profiles: Profile[];
  enabled: boolean;
}
interface ShellContext { shell: string; kind: "bash" | "zsh" | "fish"; login: boolean; env: Record<string, string | undefined>; profiles: string[] }
const START = "# Ovis communication tracking";
const END = "# End Ovis communication tracking";
const ENV_KEYS = new Set(["HOME", "SHELL", "PATH", "ZDOTDIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "HERDR_CONFIG_PATH"]);
const serial = new Map<string, Promise<unknown>>();

/** Keep only startup-path inputs, never the credentials also present in a process environment. */
function selectedEnvironment(bytes: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of bytes.split("\0")) {
    const at = entry.indexOf("=");
    if (ENV_KEYS.has(entry.slice(0, at))) env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return env;
}

function shellEnvironment(pid: number, platform: NodeJS.Platform): Record<string, string> | null {
  try {
    if (platform === "linux") return selectedEnvironment(readFileSync(`/proc/${pid}/environ`, "utf8"));
    if (platform !== "darwin") return null;
    const call = sysctlCall(), maximum = new Uint8Array(4);
    if (call(new Int32Array([1, 8]), maximum) !== 4) return null;
    const size = new DataView(maximum.buffer).getInt32(0, true);
    if (size < 4 || size > 16 * 1024 * 1024) return null;
    const answer = new Uint8Array(size), length = call(new Int32Array([1, 49, pid]), answer);
    if (length === null || length < 4) return null;
    const bytes = Buffer.from(answer.buffer, 0, length), argc = bytes.readInt32LE(0);
    let at = bytes.indexOf(0, 4);
    if (argc < 1 || at < 0) return null;
    while (at < bytes.length && bytes[at] === 0) at++;
    for (let index = 0; index < argc; index++) { at = bytes.indexOf(0, at); if (at < 0) return null; at++; }
    return selectedEnvironment(bytes.toString("utf8", at));
  } catch { return null; }
}

/** No input goes to an existing pane; the only live read is its kernel-backed initial shell environment. */
async function paneEnvironment(platform: NodeJS.Platform): Promise<Record<string, string> | null> {
  try {
    for (const pane of (await sessionSnapshot()).panes.slice(0, 4)) {
      const pid = (await paneProcessInfo(pane.pane_id))?.shell_pid;
      if (!pid || !Number.isSafeInteger(pid) || pid <= 0) continue;
      const env = shellEnvironment(pid, platform);
      if (env?.["HOME"] && env["SHELL"]) return env;
    }
  } catch {}
  return null;
}

/** A bounded private child group: startup chatter and secrets never become API output. */
function command(argv: string[], env: Record<string, string | undefined>, timeout = 5000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { env, cwd: env["HOME"], detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", bytes = 0, stopped = false, settled = false;
    const stop = () => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {} };
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok, output }); };
    const abort = () => { stopped = true; stop(); child.stdout.destroy(); child.stderr.destroy(); finish(false); };
    const timer = setTimeout(abort, timeout);
    child.stdout.on("data", (part: Buffer) => { bytes += part.length; if (bytes <= 65536) output += part.toString(); else abort(); });
    child.stderr.on("data", (part: Buffer) => { bytes += part.length; if (bytes > 65536) abort(); });
    child.on("error", () => finish(false));
    child.on("close", (code) => { stop(); finish(code === 0 && !stopped); });
  });
}

function file(path: string): { target: string; text: string; mode: number } {
  if (!existsSync(path)) {
    try { lstatSync(path); throw new Error("profile_unavailable"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { target: path, text: "", mode: 0o600 };
  }
  const target = realpathSync(path), stat = statSync(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("profile_unavailable");
  return { target, text: readFileSync(target, "utf8"), mode: stat.mode & 0o777 };
}

function replaceFile(path: string, before: string | null, text: string, mode = 0o600): void {
  const current = file(path);
  if (before !== null && current.text !== before) throw new Error("profile_changed");
  mkdirSync(dirname(current.target), { recursive: true, mode: 0o700 });
  const temporary = `${current.target}.ovis-${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { mode, flag: "wx" });
    chmodSync(temporary, mode);
    if (file(path).target !== current.target || file(path).text !== current.text) throw new Error("profile_changed");
    renameSync(temporary, current.target);
  } finally { rmSync(temporary, { force: true }); }
}

export class CommunicationTracking implements CommunicationTrackingService {
  private readonly home: string;
  private readonly platform: NodeJS.Platform;
  private readonly directory: string;
  private readonly installation: string;
  private readonly record: string;
  constructor(private readonly options: Options = {}) {
    this.home = options.home ?? homedir();
    this.platform = options.platform ?? process.platform;
    this.directory = options.directory ?? herdrCliDirectory();
    this.installation = join(this.directory, "installation");
    this.record = join(this.directory, "setup.json");
  }

  private saved(): Setup | null {
    if (!existsSync(this.record)) return null;
    const raw = JSON.parse(file(this.record).text) as Partial<Setup>;
    if (raw.version !== 1 || raw.owner !== "ovis-communication-tracking" || typeof raw.real !== "string" || !isAbsolute(raw.real) || typeof raw.shell !== "string" || typeof raw.enabled !== "boolean" || !Array.isArray(raw.profiles)
      || raw.profiles.some((entry) => !entry || typeof entry.path !== "string" || !isAbsolute(entry.path) || typeof entry.target !== "string" || !isAbsolute(entry.target) || typeof entry.block !== "string" || !entry.block.includes(START) || typeof entry.created !== "boolean")) throw new Error("unowned_installation");
    return raw as Setup;
  }
  private save(setup: Setup): void { replaceFile(this.record, null, JSON.stringify(setup) + "\n"); }

  private async context(): Promise<ShellContext | null> {
    if (!["linux", "darwin"].includes(this.platform) || !capabilities().cliCoordination) return null;
    const inherited = this.options.env ?? await paneEnvironment(this.platform);
    if (!inherited || resolve(inherited["HOME"] ?? this.home) !== resolve(this.home)) return null;
    const env: Record<string, string | undefined> = { ...process.env };
    // An absent daemon ZDOTDIR/XDG setting must stay absent, even when Ovis has its own.
    for (const key of ENV_KEYS) delete env[key];
    Object.assign(env, inherited, { HOME: this.home, HERDR_ENV: "1" });
    const configPath = this.options.configPath ?? herdrConfigPath(inherited, this.platform, this.home);
    const config = readHerdrConfig(configPath) as { terminal?: { default_shell?: unknown; shell_mode?: unknown } } | null;
    if (config === null && existsSync(configPath)) return null;
    const terminal = config?.terminal;
    const chosen = typeof terminal?.default_shell === "string" && terminal.default_shell.trim() ? terminal.default_shell.trim() : inherited["SHELL"];
    if (!chosen) return null;
    const shell = isAbsolute(chosen) ? chosen : Bun.which(chosen, { PATH: inherited["PATH"] ?? "" });
    if (!shell || !existsSync(shell)) return null;
    const kind = basename(shell);
    if (kind !== "bash" && kind !== "zsh" && kind !== "fish") return null;
    const login = terminal?.shell_mode === "login" || (terminal?.shell_mode !== "non_login" && this.platform === "darwin");
    let profiles: string[];
    if (kind === "bash") profiles = [join(this.home, ".bashrc"), [".bash_profile", ".bash_login", ".profile"].map((name) => join(this.home, name)).find(existsSync) ?? join(this.home, ".bash_profile")];
    else if (kind === "zsh") {
      // .zshenv may set ZDOTDIR before .zshrc is selected, even for a non-login shell.
      const marker = randomUUID();
      const probe = await command([shell, ...(login ? ["-l"] : []), "-c", `printf '\\n${marker}%s\\n' "\${ZDOTDIR:-$HOME}"`], env);
      const path = probe.output.split("\n").find((line) => line.startsWith(marker))?.slice(marker.length);
      if (!probe.ok || !path || !isAbsolute(path)) return null;
      profiles = [join(path, ".zshrc")];
    } else profiles = [join(inherited["XDG_CONFIG_HOME"] || join(this.home, ".config"), "fish", "config.fish")];
    return { shell, kind, login, env, profiles };
  }

  private block(context: ShellContext): string {
    const flag = shellQuote(join(this.installation, "enabled")), path = shellQuote(this.installation);
    return `${START}\n${context.kind === "fish"
      ? `if test "$HERDR_ENV" = 1; and test -f ${flag}\n    set -gx PATH ${path} $PATH\nend`
      : `if [ "\${HERDR_ENV:-}" = 1 ] && [ -f ${flag} ]; then\n    export PATH=${path}:"$PATH"\nfi`}\n${END}\n`;
  }

  private async shellCommand(context: ShellContext): Promise<string | null> {
    const marker = randomUUID();
    const classify = context.kind === "zsh" ? "whence -w herdr" : "type -t herdr";
    const result = await command([context.shell, ...(context.login ? ["-l"] : []), "-i", "-c", `printf '\\n${marker}\\n'; ${classify}; command -v herdr`], context.env);
    const lines = result.output.split(`\n${marker}\n`)[1]?.trim().split("\n");
    if (!result.ok || lines?.length !== 2 || lines[0] !== (context.kind === "zsh" ? "herdr: command" : "file")) return null;
    const path = lines[1]!;
    try { accessSync(path, constants.X_OK); return isAbsolute(path) && statSync(path).isFile() ? path : null; } catch { return null; }
  }

  private async verified(context: ShellContext): Promise<boolean> {
    if (await this.shellCommand(context) !== join(this.installation, "herdr")) return false;
    return (await command([join(this.installation, "herdr"), "--version"], context.env)).ok;
  }

  private profilesRemoved(setup: Setup): boolean {
    return setup.profiles.every((profile) => {
      try { const current = file(profile.path); return current.target === profile.target && !current.text.includes(START); } catch { return false; }
    });
  }

  async status(): Promise<CommunicationTrackingStatus> {
    let setup: Setup | null = null;
    const context = await this.context();
    const base = { shell: context?.shell ?? null, profiles: context?.profiles ?? [], detail: null, can_manage: true };
    try {
      setup = this.saved();
      if (!context) return { ...base, state: setup ? "needs_attention" : "unsupported", profiles: setup?.profiles.map((profile) => profile.path) ?? [], detail: "Communication tracking needs a supported Bash, Zsh or Fish Herdr shell on Linux or macOS. Open a terminal on this PC and check its shell configuration." };
      if (!setup) return existsSync(this.installation)
        ? { ...base, state: "needs_attention", detail: "The tracking installation directory already contains files Ovis does not own." }
        : { ...base, state: "disabled" };
      if (!setup.enabled && this.profilesRemoved(setup)) return { ...base, state: "disabled" };
      base.profiles = setup.profiles.map((profile) => profile.path);
      const intact = setup.profiles.every((profile) => { const current = file(profile.path); return current.target === profile.target && current.text.split(profile.block).length === 2; });
      if (!setup.enabled) return { ...base, state: intact ? "needs_attention" : setup.profiles.some((profile) => file(profile.path).text.includes(START)) ? "needs_attention" : "disabled", detail: intact ? "Tracking is off, but its startup block still needs cleanup. Disable it again to retry." : null };
      if (!intact || setup.shell !== context.shell || JSON.stringify(base.profiles) !== JSON.stringify(context.profiles) || !existsSync(join(this.installation, "enabled"))) return { ...base, state: "needs_attention", detail: "The shell setup changed. Disable tracking, then enable it again to verify the new setup." };
      const config = JSON.parse(file(join(this.installation, "config.json")).text) as { enabled?: boolean; bundle_revision?: number; display_state?: unknown };
      if (config.bundle_revision !== HERDR_SHIM_REVISION || config.display_state !== this.displayState()) return { ...base, state: "needs_attention", detail: "Enable communication tracking again to refresh its wrapper for peer message attribution. Existing commands keep working." };
      return config.enabled !== false && await this.verified(context)
        ? { ...base, state: "enabled" }
        : { ...base, state: "needs_attention", detail: "A new Herdr shell does not resolve herdr to the tracking wrapper. Check for a custom herdr alias or function, then try again." };
    } catch { return { ...base, state: "needs_attention", profiles: setup?.profiles.map((profile) => profile.path) ?? base.profiles, detail: "Ovis could not read or verify the tracking setup. Disable it to stop collection, or try setup again." }; }
  }

  private run(operation: () => Promise<CommunicationTrackingStatus>): Promise<CommunicationTrackingStatus> {
    const prior = serial.get(this.directory) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(async () => {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const lease = acquireOwnerDirectory(join(this.directory, ".setup-lock"), { running: "Tracking setup is busy", starting: "Tracking setup is busy" }, {}, { wait: false });
      try { return await operation(); } finally { lease.release(); }
    });
    serial.set(this.directory, current);
    void current.finally(() => { if (serial.get(this.directory) === current) serial.delete(this.directory); }).catch(() => {});
    return current;
  }

  async enable(expected?: CommunicationTrackingSetupRequest): Promise<CommunicationTrackingStatus> {
    const context = await this.context();
    const matches = (current: ShellContext | null) => !expected || expected.shell === (current?.shell ?? null) && JSON.stringify(expected.profiles) === JSON.stringify(current?.profiles ?? []);
    if (!matches(context)) throw new CommunicationTrackingSetupChanged();
    if (!context) return this.status();
    return this.run(async () => {
      const context = await this.context();
      if (!matches(context)) throw new CommunicationTrackingSetupChanged();
      if (!context) return this.status();
      try {
        let setup = this.saved();
        if (!setup && existsSync(this.installation)) throw new Error("unowned_installation");
        const changed = setup !== null && (setup.shell !== context.shell || JSON.stringify(setup.profiles.map((profile) => profile.path)) !== JSON.stringify(context.profiles));
        if (setup && changed && (setup.enabled || !this.profilesRemoved(setup))) throw new Error("shell_changed");
        const real = setup?.real ?? this.options.env?.["OVIS_HERDR_BIN"] ?? process.env["OVIS_HERDR_BIN"] ?? await this.shellCommand(context);
        if (!real || !isAbsolute(real) || resolve(real) === join(this.installation, "herdr")) throw new Error("missing_binary");
        if (!setup || changed) {
          const block = this.block(context);
          const profiles = context.profiles.map((path) => {
            const current = file(path);
            if (current.text.includes(START)) throw new Error("unowned_block");
            return { path, target: current.target, block: (current.text && !current.text.endsWith("\n") ? "\n" : "") + block, created: !existsSync(path) };
          });
          setup = { version: 1, owner: "ovis-communication-tracking", real, shell: context.shell, profiles, enabled: false };
          this.save(setup);
        }
        if (this.ownsInstallation()) this.setEnabled(setup, false);
        setup = { ...setup, enabled: false };
        this.save(setup);
        await this.ensureInstallation(setup, context.env);
        this.setEnabled(setup, false);
        for (const profile of setup.profiles) {
          const current = file(profile.path);
          if (current.target !== profile.target) throw new Error("profile_changed");
          if (current.text.includes(profile.block)) {
            if (current.text.split(profile.block).length !== 2) throw new Error("profile_changed");
          } else {
            if (current.text.includes(START)) throw new Error("profile_changed");
            replaceFile(profile.path, current.text, current.text + profile.block, current.mode);
          }
        }
        writeFileSync(join(this.installation, "enabled"), "", { mode: 0o600 });
        if (!await this.verified(context)) throw new Error("verification_failed");
        this.setEnabled(setup, true);
        this.save({ ...setup, enabled: true });
        return this.status();
      } catch {
        let stopped = false;
        try { const saved = this.saved(); if (saved && this.ownsInstallation()) { this.setEnabled(saved, false); stopped = true; } } catch {}
        const status = await this.status();
        return { ...status, state: "needs_attention", detail: stopped
          ? "Tracking setup did not finish. Collection is off. Check this PC's shell setup, then retry or disable tracking to remove its setup block."
          : "Tracking setup did not finish, and Ovis could not verify that collection stopped. Check this PC's setup, then retry or disable tracking." };
      }
    });
  }

  private ownsInstallation(): boolean {
    try {
      const marker = JSON.parse(file(join(this.installation, "owner.json")).text) as { version?: unknown; owner?: unknown };
      return marker.version === 1 && marker.owner === "ovis-herdr-cli-shim";
    } catch { return false; }
  }

  private async ensureInstallation(setup: Setup, env: Record<string, string | undefined>): Promise<void> {
    if (existsSync(this.installation)) {
      if (!this.ownsInstallation()) {
        if (!setup.enabled && readdirSync(this.installation).length === 0) rmdirSync(this.installation);
        else throw new Error("unowned_installation");
      } else {
        let complete = false;
        try {
          const config = JSON.parse(file(join(this.installation, "config.json")).text) as { version?: unknown; real?: unknown; journal?: unknown; bundle_revision?: unknown; display_state?: unknown };
          complete = config.version === 1 && config.bundle_revision === HERDR_SHIM_REVISION && config.real === setup.real && config.journal === this.directory && config.display_state === this.displayState()
            && statSync(join(this.installation, "observe.js")).isFile() && statSync(join(this.installation, "herdr")).isFile();
        } catch {}
        if (complete && (await command([join(this.installation, "herdr"), "--version"], env)).ok) return;
      }
    }
    const stage = join(this.directory, `.installation-${randomUUID()}`);
    try {
      const installed = await command([process.execPath, join(import.meta.dir, "../scripts/herdr-shim.ts"), "install", "--real", setup.real, "--directory", stage, "--journal", this.directory, "--display-state", this.displayState(), "--enabled", "false"], { ...env, HOME: this.home }, 30_000);
      if (!installed.ok || !(await command([process.execPath, join(stage, "observe.js"), "--shim", join(stage, "config.json"), "--", "--version"], env)).ok) throw new Error("install_failed");
      writeFileSync(join(stage, "herdr"), herdrCliLauncher(realpathSync(process.execPath), this.installation), { mode: 0o700 });
      if (!existsSync(this.installation)) renameSync(stage, this.installation);
      else {
        if (!this.ownsInstallation()) throw new Error("unowned_installation");
        // Keep the inherited command path present throughout publication and retain unrelated files.
        for (const name of ["observe.js", "config.json", "herdr"]) {
          const path = join(this.installation, name);
          replaceFile(path, file(path).text, readFileSync(join(stage, name), "utf8"), name === "herdr" ? 0o700 : 0o600);
        }
      }
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }

  private displayState(): string { return resolve(this.options.stateDir ?? defaultStateDir(this.options.env)); }

  private setEnabled(setup: Setup, enabled: boolean): void {
    if (!this.ownsInstallation()) throw new Error("unowned_installation");
    const path = join(this.installation, "config.json"), before = file(path).text;
    let bundle_revision: unknown;
    try { bundle_revision = (JSON.parse(before) as { bundle_revision?: unknown }).bundle_revision; } catch {}
    replaceFile(path, before, JSON.stringify({ version: 1, bundle_revision, real: setup.real, journal: this.directory, display_state: this.displayState(), enabled }) + "\n");
    if (!enabled) rmSync(join(this.installation, "enabled"), { force: true });
  }

  async disable(): Promise<CommunicationTrackingStatus> {
    if (!existsSync(this.record)) return this.status();
    return this.run(async () => {
      const setup = this.saved();
      if (!setup) return this.status();
      if (existsSync(this.installation) && !this.ownsInstallation() && readdirSync(this.installation).length !== 0) throw new Error("unowned_installation");
      if (this.ownsInstallation()) this.setEnabled(setup, false);
      this.save({ ...setup, enabled: false });
      let repairFailed = false;
      try { await this.ensureInstallation({ ...setup, enabled: false }, this.options.env ?? process.env); this.setEnabled(setup, false); }
      catch { repairFailed = true; }
      let conflict = false;
      for (const profile of setup.profiles) {
        try {
          const current = file(profile.path);
          if (current.target !== profile.target || current.text.split(profile.block).length > 2) throw new Error("profile_changed");
          if (current.text.includes(profile.block)) {
            const remaining = current.text.replace(profile.block, "");
            // An empty login file created here would keep masking a .profile added later.
            if (!remaining && profile.created && current.target === profile.path) {
              if (file(profile.path).text !== current.text) throw new Error("profile_changed");
              rmSync(profile.path);
            } else replaceFile(profile.path, current.text, remaining, current.mode);
          }
          else if (current.text.includes(START)) conflict = true;
        } catch { conflict = true; }
      }
      const status = await this.status();
      return conflict ? { ...status, state: "needs_attention", detail: "Tracking is off. An edited startup block was left in place to preserve your changes." }
        : repairFailed ? { ...status, state: "needs_attention", detail: "Tracking is off. The existing command was retained, but its repair could not finish. Check the installed Herdr executable, then retry setup." } : status;
    });
  }
}
