import { afterAll, beforeAll, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-move-api-contract-"));
let app: ReturnType<typeof createServer>;
let base: string, watcher: string;
beforeAll(() => {
  app = createServer({ port: 0, hostname: "127.0.0.1", stateDir: root, token: "", sidecar: false, codexHome: join(root, "codex") });
  base = `http://127.0.0.1:${app.port}`;
  const devices = app.context.services.devices;
  const device = devices.pair(devices.startPairing().code, "Owned move watcher", "watch")!;
  watcher = `ovis_device=${encodeURIComponent(device.token)}`;
});
afterAll(() => { app?.stop(); rmSync(root, { recursive: true, force: true }); });
const mutation = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/session-moves`, { method: "POST", headers: { origin: base, "content-type": "application/json", "x-herdr-machine": "1", ...headers }, body: JSON.stringify(body) });

it("exposes private recoverable state only to control callers and rejects unreviewed or malformed mutations", async () => {
  const response = await fetch(`${base}/api/session-moves`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ moves: [] });
  const malformed = await mutation({ action: "preview", request: { untracked_files: ["../escape"] } });
  expect(malformed.status).toBe(409);
  expect((await malformed.json()).error.code).toBe("invalid_move_request");
  const stale = await mutation({ action: "run", id: "00000000-0000-4000-8000-000000000020", fingerprint: "unreviewed" });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe("move_not_found");
  expect((await mutation({}, { origin: "https://other.invalid" })).status).toBe(403);
  expect((await fetch(`${base}/api/session-moves`, { method: "POST", headers: { origin: base }, body: "{}" })).status).toBe(403);
  for (const method of ["GET", "POST"]) {
    const denied = await fetch(`${base}/api/session-moves`, { method, headers: { origin: base, cookie: watcher, "x-herdr-machine": "1" }, ...(method === "POST" ? { body: "{}" } : {}) });
    expect(denied.status).toBe(403);
  }
});

it("never allows a browser control credential or watcher to call the machine transfer node", async () => {
  for (const cookie of ["", watcher]) {
    const response = await fetch(`${base}/api/session-moves/node`, { method: "POST", headers: { origin: base, cookie, "x-herdr-machine": "1" }, body: JSON.stringify({ operation_id: "00000000-0000-4000-8000-000000000020", action: "capabilities", payload: {} }) });
    expect(response.status).toBe(403);
  }
  expect((await (await fetch(`${base}/api/session-moves`)).json()).moves).toEqual([]);
});

it("does not expose private move state through local machine aliases", async () => {
  for (const path of ["session-moves", "session-moves/node"]) {
    const response = await fetch(`${base}/api/machines/local/${path}`, { headers: { cookie: watcher } });
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('"moves"');
  }
});
