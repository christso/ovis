import { spawn } from "node:child_process";
import type { AgentInfo } from "../shared/herdr-api.generated.ts";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { withoutHerdrDiagnostics } from "../server/herdr/client.ts";
import { herdrCliCaller, herdrCliDirectory, herdrCliEndpoint, herdrCliIdentity, herdrCliOperation, herdrCliPrompt, herdrCliReplySession, herdrCliSocket, herdrCliSubmitted, recordHerdrCli, sameHerdrCliEndpoint } from "../server/herdr/cli-observations.ts";

import { graphCliTerminalMetadata } from "../shared/graph-cli.ts";
import { herdrCliLauncher } from "../server/herdr/cli-launcher.ts";

import { preparePeerMessage, publishPeerMessage, stagePeerMessage } from "../server/message-sources.ts";
import { observePeerDisplayName } from "../server/message-source-name.ts";
import { defaultStateDir } from "../server/update-state.ts";
import { HERDR_SHIM_REVISION } from "../shared/communication-tracking.ts";

interface Config { version: 1; bundle_revision?: number; real: string; journal: string; display_state?: string; enabled?: boolean }

function captureEnabled(path: string): boolean {
  try { return (JSON.parse(readFileSync(path, "utf8")) as Config).enabled !== false; }
  catch { return false; }
}

function isShim(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const prefix = Buffer.alloc(128);
    let length = 0;
    while (length < prefix.length) {
      const read = readSync(fd, prefix, length, prefix.length - length, null);
      if (!read) break;
      length += read;
    }
    return prefix.subarray(0, length).toString().includes("Ovis Herdr CLI shim");
  } finally { closeSync(fd); }
}

async function install(args: string[]): Promise<void> {
  if (process.platform === "win32") throw new Error("Herdr CLI observation installation currently supports Linux and macOS");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--real", "--directory", "--journal", "--display-state", "--enabled"].includes(args[index] ?? "") || !args[index + 1] || values.has(args[index]!)) throw new Error("Use install --real /absolute/herdr --directory /absolute/shim-directory [--journal /absolute/journal-directory] [--display-state /absolute/ovis-state-directory] [--enabled true|false]");
    values.set(args[index]!, args[index + 1]!);
  }
  const requested = values.get("--real"), directory = values.get("--directory");
  if (values.has("--enabled") && !["true", "false"].includes(values.get("--enabled")!)) throw new Error("--enabled must be true or false");
  if (!requested || !directory || !isAbsolute(requested) || !isAbsolute(directory) || (values.has("--journal") && !isAbsolute(values.get("--journal")!)) || (values.has("--display-state") && !isAbsolute(values.get("--display-state")!))) throw new Error("The real binary, shim directory and journal directory must be absolute paths");
  const real = resolve(requested), actual = realpathSync(real), path = resolve(directory);
  if (!lstatSync(actual).isFile() || actual === join(path, "herdr") || isShim(real)) throw new Error("--real must name the installed Herdr executable, not another Ovis shim");
  mkdirSync(path, { mode: 0o700 });
  try {
    writeFileSync(join(path, "owner.json"), JSON.stringify({ version: 1, owner: "ovis-herdr-cli-shim" }) + "\n", { mode: 0o600, flag: "wx" });
    const bundle = join(path, "observe.js");
    const built = await Bun.build({ entrypoints: [import.meta.path], target: "bun", packages: "bundle", outfile: bundle });
    if (!built.success) throw new Error(`Cannot bundle the shim: ${built.logs.join("\n")}`);
    await Bun.write(bundle, built.outputs[0]!);
    const config = join(path, "config.json");
    writeFileSync(config, JSON.stringify({ version: 1, bundle_revision: HERDR_SHIM_REVISION, display_state: resolve(values.get("--display-state") ?? defaultStateDir()), real, journal: values.get("--journal") ?? herdrCliDirectory(), enabled: values.get("--enabled") !== "false" } satisfies Config) + "\n", { mode: 0o600 });
    writeFileSync(join(path, "herdr"), herdrCliLauncher(realpathSync(process.execPath), path), { mode: 0o700 });
    console.log(JSON.stringify({ directory: path, real, journal: values.get("--journal") ?? herdrCliDirectory() }));
  } catch (error) { rmSync(path, { recursive: true, force: true }); throw error; }
}

function executeHerdr(real: string, args: string[]): never {
  process.execve(real, [real, ...args], process.env as Record<string, string>);
  throw new Error("Cannot execute Herdr");
}

async function run(configPath: string, args: string[]): Promise<void> {
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1 || !("real" in raw) || typeof raw.real !== "string"
    || !isAbsolute(raw.real) || !("journal" in raw) || typeof raw.journal !== "string" || !isAbsolute(raw.journal)) throw new Error("Cannot read the Herdr CLI shim configuration");
  const config = raw as Config;
  const operation = herdrCliOperation(args);
  if (config.enabled === false || !operation || process.env["HERDR_ENV"] !== "1" || !process.env["HERDR_PANE_ID"]) {
    executeHerdr(config.real, args);
  }
  const sourceSocket = herdrCliSocket(null), targetSocket = herdrCliSocket(operation.session), caller = process.env["HERDR_PANE_ID"]!;
  const occurred_at = new Date().toISOString(), targetNamespace = herdrCliIdentity(targetSocket, config.journal);
  const [source, target] = await Promise.all([
    herdrCliCaller(sourceSocket, caller, config.journal),
    operation.kind === "communication" ? herdrCliEndpoint(targetSocket, operation.target, config.journal) : Promise.resolve(null),
  ]);
  const prompt = herdrCliPrompt(args);
  const prepared = prompt && source && target && captureEnabled(configPath)
    ? preparePeerMessage(args[prompt.body]!, source, target, config.journal, await observePeerDisplayName(sourceSocket, source, typeof config.display_state === "string" && isAbsolute(config.display_state) ? config.display_state : undefined), herdrCliReplySession(sourceSocket)) : null;
  const discardPending = prepared ? stagePeerMessage(prepared, sourceSocket, configPath, config.journal) : () => {};
  process.once("exit", discardPending);
  const forwarded = [...args];
  if (prepared && prompt) forwarded[prompt.body] = prepared.text;
  // A separate session receives terminal signals only through us. Inherited stdin remains
  // the same TTY/file descriptor; noninteractive start/prompt never acquire terminal control.
  let child: ReturnType<typeof spawn>;
  try { child = spawn(config.real, forwarded, { detached: true, stdio: ["inherit", "pipe", "pipe"], env: process.env }); }
  catch (error) {
    // Envelope growth can exceed exec's argument limit. E2BIG proves no command executed.
    if (prepared && (error as NodeJS.ErrnoException).code === "E2BIG") { discardPending(); executeHerdr(config.real, args); }
    throw error;
  }
  let childClosed = false;
  const forward = (signal: NodeJS.Signals) => { if (!childClosed && child.pid) try { process.kill(-child.pid, signal); } catch {} };
  let outputExitCode = 0, reapTimer: ReturnType<typeof setTimeout> | undefined;
  const outputClosed = (error: NodeJS.ErrnoException) => {
    if (outputExitCode) return;
    const pipeClosed = error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED";
    outputExitCode = pipeClosed ? 141 : 1;
    child.stdout!.unpipe(process.stdout); child.stderr!.unpipe(process.stderr);
    child.stdout!.destroy(); child.stderr!.destroy();
    forward(pipeClosed ? "SIGPIPE" : "SIGTERM");
    // Reap even a CLI that ignores SIGPIPE or stops reading/writing after the consumer exits.
    if (!childClosed) reapTimer = setTimeout(() => forward("SIGKILL"), 1000);
  };
  process.stdout.on("error", outputClosed); process.stderr.on("error", outputClosed);
  const buffers: Buffer[][] = [[], []], lengths = [0, 0];
  const collect = (part: Buffer, index: number) => {
    lengths[index]! += part.byteLength;
    if (lengths[index]! <= 262144) buffers[index]!.push(part);
  };
  child.stdout!.on("data", (part: Buffer) => collect(part, 0)); child.stdout!.pipe(process.stdout, { end: false });
  child.stderr!.on("data", (part: Buffer) => collect(part, 1)); child.stderr!.pipe(process.stderr, { end: false });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const;
  const handlers = signals.map((signal) => { const handler = () => forward(signal); process.on(signal, handler); return handler; });
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once("close", (code, signal) => { childClosed = true; resolve([code, signal]); }); child.once("error", (error: NodeJS.ErrnoException) => {
      if (prepared && !child.pid && error.code === "E2BIG") { discardPending(); executeHerdr(config.real, args); }
      reject(error);
    });
  });
  // Queue a write barrier after the forwarded bytes, so an early consumer close is observed
  // even if the CLI already exited before the destination finished writing its last chunk.
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => { stream.write("", (error) => { if (error) outputClosed(error); resolve(); }); })));
  clearTimeout(reapTimer);
  for (const [index, signal] of signals.entries()) process.off(signal, handlers[index]!);
  if (outputExitCode) process.exit(outputExitCode);
  process.stdout.off("error", outputClosed); process.stderr.off("error", outputClosed);
  let response: unknown;
  try {
    const index = lengths[0] ? 0 : 1;
    if (lengths[index]! <= 262144) response = JSON.parse(Buffer.concat(buffers[index]!).toString());
  } catch {}
  if (source && targetNamespace && captureEnabled(configPath) && herdrCliSubmitted(operation.kind, code, response)) {
    const currentSource = await herdrCliCaller(sourceSocket, caller, config.journal);
    const currentNamespace = herdrCliIdentity(targetSocket, config.journal);
    if (prepared && target && sameHerdrCliEndpoint(source, currentSource) && captureEnabled(configPath)) {
      const currentTarget = await herdrCliEndpoint(targetSocket, target.pane_id, config.journal);
      if (sameHerdrCliEndpoint(target, currentTarget) && captureEnabled(configPath)) publishPeerMessage(prepared, config.journal);
    }
    const reported = (response as { result?: { agent?: AgentInfo } }).result?.agent;
    // A status-wait error has no agent in its final response: retain pre/post recipient proof.
    const waited = !reported && target ? await herdrCliEndpoint(targetSocket, operation.target, config.journal) : null;
    const recipient = reported ?? (sameHerdrCliEndpoint(target, waited) ? target : null);
    if (sameHerdrCliEndpoint(source, currentSource) && recipient && currentNamespace?.server_id === targetNamespace.server_id && currentNamespace.boot_id === targetNamespace.boot_id && captureEnabled(configPath)) {
      recordHerdrCli(sourceSocket, { id: randomUUID(), kind: operation.kind, producer: "herdr-cli", scope: "terminal", occurred_at,
        source_terminal: graphCliTerminalMetadata(source),
        target_terminal: { ...targetNamespace, terminal_id: recipient.terminal_id, pane_id: recipient.pane_id, agent: recipient.agent ?? null, name: recipient.name ?? null },
      }, config.journal);
    }
  }
  discardPending();
  process.off("exit", discardPending);
  if (signal) { process.kill(process.pid, signal); return; }
  process.exitCode = code ?? 1;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "install") await install(args.slice(1));
    else if (args[0] === "--shim" && args[1] && args[2] === "--") await withoutHerdrDiagnostics(() => run(args[1]!, args.slice(3)));
    else throw new Error("Use bun scripts/herdr-shim.ts install --real /absolute/herdr --directory /absolute/shim-directory [--journal /absolute/journal-directory]");
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
