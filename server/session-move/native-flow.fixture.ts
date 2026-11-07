/** Actual installed Codex process driver; fixture identity/transport is separate and explicitly labeled. */
import { join } from "node:path";
import type { FlowDriver } from "./flow.fixture.ts";
import { FIXTURE_THREAD } from "./flow.fixture.ts";
import { MoveRefused } from "./files.ts";

export async function ownedCodex(home: string, fixtureRoot: string) {
  const child = Bun.spawn(["codex", "app-server", "--stdio"], {
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: fixtureRoot, CODEX_HOME: home, XDG_CONFIG_HOME: join(fixtureRoot, "config"), XDG_DATA_HOME: join(fixtureRoot, "data"), XDG_STATE_HOME: join(fixtureRoot, "state") },
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  const pending = new Map<number, { resolve(value: any): void; reject(reason: unknown): void }>(); let next = 0;
  const reading = (async () => {
    let buffer = ""; const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true }); let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const row = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        const wait = pending.get(row.id); if (wait) { pending.delete(row.id); if (row.error) wait.reject(new Error(JSON.stringify(row.error))); else wait.resolve(row.result); }
      }
    }
    for (const wait of pending.values()) wait.reject(new Error("Owned native fixture ended")); pending.clear();
  })();
  function call(method: string, params: Record<string, unknown>): Promise<any> {
    const id = ++next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Owned Codex fixture timed out")); }, 15_000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(reason) { clearTimeout(timer); reject(reason); } });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  let closed = false;
  async function close() {
    if (closed) return; closed = true; child.stdin.end();
    const timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 10_000);
    try { await child.exited; await reading; } finally { clearTimeout(timeout); }
  }
  try { await call("initialize", { clientInfo: { name: "ovis_owned_move_fixture", title: "Owned native transfer fixture", version: "1" }, capabilities: null }); child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n"); }
  catch (error) { await close(); throw error; }
  return { call, close };
}
export function nativeFlowDriver(): FlowDriver & { initialize(home: string, cwd: string, root: string): Promise<void>; inspect(): Promise<unknown> } {
  const clients = new Map<string, Awaited<ReturnType<typeof ownedCodex>>>();
  let sourceHome = "", destinationHome = "", fixtureRoot = "";
  const open = async (home: string) => { let client = clients.get(home); if (!client) { client = await ownedCodex(home, fixtureRoot); clients.set(home, client); } return client; };
  return {
    async initialize(home, cwd, root) {
      fixtureRoot = root; sourceHome = home;
      const version = Bun.spawnSync(["codex", "--version"], { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
      if (version !== "codex-cli 0.166.0") throw new MoveRefused("codex_incompatible", "Owned native qualification requires the installed 0.166.0 CLI");
      await (await open(home)).call("thread/resume", { threadId: FIXTURE_THREAD, cwd, excludeTurns: true });
    },
    async native(home, destination) { if (destination) destinationHome = home; const client = await open(home); return { call: client.call, async close() {} }; },
    async start(home, cwd) { await (await open(home)).call("thread/resume", { threadId: FIXTURE_THREAD, cwd, excludeTurns: true }); },
    async exit() { const source = clients.get(sourceHome); clients.delete(sourceHome); await source?.close(); },
    async inspect() { return (await open(destinationHome)).call("thread/items/list", { threadId: FIXTURE_THREAD, limit: 100 }); },
    async close() { for (const client of clients.values()) await client.close(); clients.clear(); },
  };
}
