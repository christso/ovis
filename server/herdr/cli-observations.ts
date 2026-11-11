import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, type Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentInfo } from "../../shared/herdr-api.generated.ts";
import type { HerdrCoordinationEndpoint, HerdrCoordinationPage, GraphCliObservation, GraphCliPage } from "../../shared/graph-registry.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import { graphHerdrEndpointKey } from "../../shared/graph-relationships.ts";
import { processAgent } from "../agent-identity.ts";
import { darwinStartTime } from "../darwin-process.ts";
import { finishHerdrIdentity, herdrLifetime } from "../finishes.ts";
import { herdrRpc, herdrSocketPath, sameSocket } from "./client.ts";
import { linuxStartTicks } from "../process-owner.ts";
import { graphCliObservationMetadata, graphCliObservationValue } from "../../shared/graph-cli.ts";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface HerdrCliOperation { kind: "delegation" | "communication"; target: string; session: string | null }

/** Match only the supported CLI surface; Herdr remains responsible for parsing and errors. */
export function herdrCliOperation(args: readonly string[]): HerdrCliOperation | null {
  let session: string | null = null;
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (word === "--") break;
    if (word === "--machine" || word === "--remote" || word.startsWith("--machine=") || word.startsWith("--remote=")) return null;
    if (word === "--session") { session = args[++index] ?? ""; continue; }
    if (word.startsWith("--session=")) { session = word.slice(10); continue; }
    words.push(word);
  }
  if (session !== null && (session.length > 64 || session === "." || session === ".." || !/^[a-zA-Z0-9._-]+$/.test(session))) return null;
  if (words[0] !== "agent" || !["start", "prompt"].includes(words[1] ?? "")) return null;
  const command = words[1]!;
  let target: string | undefined;
  for (let index = 2; index < words.length; index += 1) {
    const word = words[index]!;
    if (["--help", "-h"].includes(word)) return null;
    if (["--kind", "--pane", "--timeout", "--until"].includes(word)) { index += 1; continue; }
    if (word.startsWith("-")) continue;
    target = word; break;
  }
  return target ? { kind: command === "start" ? "delegation" : "communication", target, session } : null;
}

/** These two wait errors are emitted only after successful submission in the supported Herdr CLI. */
export function herdrCliSubmitted(kind: HerdrCliOperation["kind"], code: number | null, response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const value = response as { result?: { agent?: { terminal_id?: unknown } }; error?: { code?: unknown; message?: unknown } };
  if (code === 0) return typeof value.result?.agent?.terminal_id === "string";
  return kind === "communication" && code === 1 && ((value.error?.code === "timeout" && value.error.message === "timed out waiting for agent status")
    || (value.error?.code === "agent_prompt_stalled" && typeof value.error.message === "string"
      && /^agent prompt produced no observed working or blocked state within \d+ ms; current status is [a-z]+$/.test(value.error.message)));
}

export function herdrCliDirectory(env: Record<string, string | undefined> = process.env): string {
  return resolve(env["OVIS_HERDR_CLI_DIR"] || join(env["XDG_STATE_HOME"] || join(homedir(), ".local/state"), "ovis", "herdr-cli"));
}

/** The CLI's explicit session overrides its inherited socket; caller attribution keeps the original. */
export function herdrCliSocket(session: string | null, env: Record<string, string | undefined> = process.env): string {
  if (session === null && env["HERDR_SOCKET_PATH"]) return env["HERDR_SOCKET_PATH"];
  const selected = session ?? env["HERDR_SESSION"] ?? "default";
  const config = join(env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "herdr");
  return selected === "default" ? join(config, "herdr.sock") : join(config, "sessions", selected, "herdr.sock");
}

interface Namespace { directory: string; server: string; boot: string }
function namespace(socket: string, root: string): Namespace | null {
  const identity = finishHerdrIdentity(socket);
  if (!identity || !["linux", "darwin"].includes(process.platform)) return null;
  const directory = join(root, digest(sameSocket(socket)));
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return null;
    const path = join(directory, "identity.json");
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try { writeFileSync(fd, JSON.stringify({ version: 1, id: randomUUID() }) + "\n"); fsyncSync(fd); }
      finally { closeSync(fd); }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null; }
    if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 1024) return null;
    const saved = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; id?: unknown };
    if (saved.version !== 1 || typeof saved.id !== "string" || !uuid.test(saved.id)) return null;
    return { directory, server: `herdr-cli:${saved.id}`, boot: herdrLifetime(identity) };
  } catch { return null; }
}

function birth(pid: number): string | null {
  try {
    if (process.platform === "darwin") return darwinStartTime(pid)?.toString() ?? null;
    if (process.platform !== "linux") return null;
    const ticks = linuxStartTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
    return ticks === null ? null : `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`;
  } catch { return null; }
}

async function endpointInInventory(socket: string, agent: AgentInfo, owner: Namespace): Promise<HerdrCoordinationEndpoint | null> {
  if (!agent.agent || !agent.terminal_id) return null;
  try {
    const info = (await herdrRpc("pane.process_info", { pane_id: agent.pane_id }, socket, 500)).process_info;
    if (!info) return null;
    const platform = process.platform === "darwin" ? "macos" : "linux";
    const candidates = (info.foreground_processes ?? []).filter((entry) => entry.pid !== info.shell_pid
      && processAgent(entry.argv?.length ? entry.argv : [entry.argv0 ?? entry.name], platform) === agent.agent);
    if (candidates.length !== 1) return null;
    const pid = candidates[0]!.pid, started = birth(pid);
    if (!started || herdrLifetime(finishHerdrIdentity(socket) ?? "") !== owner.boot) return null;
    return { server_id: owner.server, boot_id: owner.boot, terminal_id: agent.terminal_id,
      agent_instance_id: digest(JSON.stringify([agent.terminal_id, pid, started, agent.agent])), agent: agent.agent, pane_id: agent.pane_id, name: agent.name ?? null };
  } catch { return null; }
}

/** Current process identity, never a name, pane number, reported native-session hint or PID alone. */
export async function herdrCliEndpoint(socket: string, target: string, root = herdrCliDirectory()): Promise<HerdrCoordinationEndpoint | null> {
  const owner = namespace(socket, root);
  if (!owner) return null;
  try {
    const before = (await herdrRpc<{ agent: AgentInfo }>("agent.get", { target }, socket, 500)).agent;
    const previous = await endpointInInventory(socket, before, owner);
    if (!previous) return null;
    const after = (await herdrRpc<{ agent: AgentInfo }>("agent.get", { target: before.pane_id }, socket, 500)).agent;
    const current = await endpointInInventory(socket, after, owner);
    return sameHerdrCliEndpoint(previous, current) ? current : null;
  } catch { return null; }
}

/** Resolve a moved inherited caller in its own server, never against the operation's target namespace. */
export async function herdrCliCaller(socket: string, pane: string, root = herdrCliDirectory()): Promise<HerdrCoordinationEndpoint | null> {
  try {
    const current = await herdrRpc<{ pane: { pane_id: string } }>("pane.current", { caller_pane_id: pane }, socket, 500);
    return herdrCliEndpoint(socket, current.pane.pane_id, root);
  } catch { return null; }
}

/** One private, fsynced immutable record per operation. Recording failure never changes CLI execution. */
export function recordHerdrCli(socket: string, receipt: GraphCliObservation, root = herdrCliDirectory()): void {
  let temporary: string | undefined;
  try {
    const owner = namespace(socket, root);
    if (!uuid.test(receipt.id) || !owner || owner.server !== receipt.source_terminal.server_id || owner.boot !== receipt.source_terminal.boot_id) return;
    if (!graphCliObservationValue(receipt)) return;
    temporary = join(owner.directory, `${receipt.id}.tmp`);
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, receipt: graphCliObservationMetadata(receipt) }) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); }
    linkSync(temporary, join(owner.directory, `${receipt.id}.json`));
    rmSync(temporary); temporary = undefined;
    const directory = openSync(owner.directory, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch {}
  finally { if (temporary) try { rmSync(temporary, { force: true }); } catch {} }
}

/** Namespace identity is location evidence only, independent of an agent process. */
export function herdrCliIdentity(socket: string, root = herdrCliDirectory()): Pick<GraphCliPage, "server_id" | "boot_id"> | null {
  const owner = namespace(socket, root);
  return owner ? { server_id: owner.server, boot_id: owner.boot } : null;
}

interface Scan { seen: Set<string>; receipts: Map<string, GraphCliObservation>; cursor?: Dir }
const scans = new Map<string, Scan>();
const pending = new Map<string, Promise<GraphCliPage | undefined>>();

/** Read bounded batches; immutable records survive Ovis downtime and repeated imports deduplicate. */
export function herdrCliObservations(socket = herdrSocketPath(), root = herdrCliDirectory()): Promise<GraphCliPage | undefined> {
  const key = JSON.stringify([root, sameSocket(socket)]);
  const running = pending.get(key);
  if (running) return running;
  const read = collect(socket, root).finally(() => pending.delete(key));
  pending.set(key, read); return read;
}

async function collect(socket: string, root: string): Promise<GraphCliPage | undefined> {
  const owner = namespace(socket, root);
  if (!owner) return undefined;
  let scan = scans.get(owner.directory);
  if (!scan) { scan = { seen: new Set(), receipts: new Map() }; scans.set(owner.directory, scan); }
  try {
    scan.cursor ??= await opendir(owner.directory);
    for (let count = 0; count < 1000; count += 1) {
      const entry = await scan.cursor.read();
      if (!entry) { await scan.cursor.close(); scan.cursor = undefined; break; }
      if (!entry.isFile() || !uuid.test(entry.name.replace(/\.json$/, "")) || !entry.name.endsWith(".json") || scan.seen.has(entry.name)) continue;
      scan.seen.add(entry.name);
      try {
        const path = join(owner.directory, entry.name), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) continue;
        const record = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; receipt?: unknown };
        if (record.version === 1 && graphCliObservationValue(record.receipt) && record.receipt.source_terminal.server_id === owner.server)
          scan.receipts.set(record.receipt.id, graphCliObservationMetadata(record.receipt));
      } catch {}
    }
  } catch {}
  if (herdrLifetime(finishHerdrIdentity(socket) ?? "") !== owner.boot) return undefined;
  return { version: 1, server_id: owner.server, boot_id: owner.boot, receipts: [...scan.receipts.values()] };
}

/** Fresh current process proof is separate from terminal-scoped CLI observations. */
export async function herdrCliSnapshot(snapshot: SessionSnapshot, socket = herdrSocketPath(), root = herdrCliDirectory()): Promise<Pick<HerdrCoordinationPage, "version" | "server_id" | "boot_id" | "agents"> | undefined> {
  const owner = namespace(socket, root);
  if (!owner || !snapshot.herdr_lifetime) return undefined;
  const eligible = snapshot.agents.filter((agent) => snapshot.panes.some((pane) => !pane.restore_error
    && pane.pane_id === agent.pane_id && pane.terminal_id === agent.terminal_id && pane.agent === agent.agent));
  const agents: HerdrCoordinationEndpoint[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, eligible.length) }, async () => {
    for (let index = next++; index < eligible.length; index = next++) {
      const endpoint = await endpointInInventory(socket, eligible[index]!, owner);
      if (endpoint) agents.push(endpoint);
    }
  }));
  if (herdrLifetime(finishHerdrIdentity(socket) ?? "") !== owner.boot) return undefined;
  return { version: 1, server_id: owner.server, boot_id: owner.boot, agents };
}

export function sameHerdrCliEndpoint(a: HerdrCoordinationEndpoint | null, b: HerdrCoordinationEndpoint | null): boolean {
  return a !== null && b !== null && graphHerdrEndpointKey(a) === graphHerdrEndpointKey(b);
}
