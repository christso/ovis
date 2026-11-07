import { MoveRefused } from "./files.ts";

const ALLOWED = new Set(["thread/read", "thread/turns/list", "thread/items/list", "account/read"]);
/** Read-only native monitoring. `proxy` joins an existing daemon; `stdio` owns only its preparation process. */
export class NativeMoveClient {
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private sequence = 0;
  private closed = false;
  private constructor(private readonly child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "ignore">>, private readonly ready: Promise<void>) {}
  static async open(home: string, mode: "proxy" | "stdio", options: { executable?: string; env?: Record<string, string | undefined> } = {}): Promise<NativeMoveClient> {
    const child = Bun.spawn([options.executable ?? "codex", "app-server", ...(mode === "proxy" ? ["proxy"] : ["--stdio"])], {
      env: { ...options.env ?? process.env, CODEX_HOME: home }, stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    const client = new NativeMoveClient(child, Promise.resolve());
    void client.read();
    try {
      const initialized = await client.request("initialize", { clientInfo: { name: "ovis_session_move", title: "Ovis session move", version: "1" }, capabilities: null });
      if (!initialized || typeof initialized !== "object" || (initialized as { codexHome?: string }).codexHome !== home) throw new MoveRefused("native_home_mismatch", "Codex is using a different session store");
      if (!/\/0\.166\.0(?:\s|$)/.test((initialized as { userAgent?: string }).userAgent ?? "")) throw new MoveRefused("codex_incompatible", "The running Codex server differs from the supported 0.166.0 runtime");
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
      return client;
    } catch (error) { await client.close(); throw error; }
  }
  async call(method: "thread/read" | "thread/turns/list" | "thread/items/list" | "account/read", params: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (!ALLOWED.has(method)) throw new MoveRefused("native_method_refused", "Transfer monitoring cannot change a native session");
    return this.request(method, params);
  }
  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new MoveRefused("native_disconnected", "Native Codex monitoring disconnected"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MoveRefused("native_timeout", "Native Codex monitoring timed out")); }, 15_000);
      this.pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
      try { this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n"); }
      catch { this.pending.get(id)?.reject(new MoveRefused("native_disconnected", "Native Codex monitoring disconnected")); this.pending.delete(id); }
    });
  }
  private async read(): Promise<void> {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of this.child.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) throw new Error("native response too large");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const row = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (row.method && row.id !== undefined) throw new Error("native server requested input");
          const pending = this.pending.get(row.id);
          if (pending) { this.pending.delete(row.id); if (row.error) pending.reject(new MoveRefused("native_refused", "Native Codex could not read this session")); else pending.resolve(row.result); }
        }
      }
    } catch { /* only fixed errors cross the monitor boundary */ }
    finally {
      this.closed = true;
      for (const pending of this.pending.values()) pending.reject(new MoveRefused("native_disconnected", "Native Codex monitoring disconnected"));
      this.pending.clear();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    try { this.child.stdin.end(); } catch { /* already exited */ }
    // This child is our read-only proxy/preparation process, never the daemon or a user's client.
    if (this.child.exitCode === null) this.child.kill();
    await this.child.exited;
  }
}
