import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./index.ts";
import { herdrRpc, workspaceClose, workspaceCreate } from "./herdr/client.ts";
import type { FlockRegistry } from "../shared/flock.ts";
import type { MachineRoster } from "../shared/machines.ts";
import { flockBinding } from "../shared/flock-inventory.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-flock-contract-"));
let app: ReturnType<typeof createServer>;
let pane: string;
let workspace: string;
let base: string;
let watchCookie: string;
const native = "00000000-0000-4000-8000-000000000019";
const nextNative = "00000000-0000-4000-8000-000000000020";
const headers = () => ({ origin: base, "content-type": "application/json", "x-herdr-machine": "1" });
beforeAll(async () => {
  const created = await workspaceCreate({ cwd: root, label: "ovis-test-flock" });
  workspace = created.workspace.workspace_id; pane = created.root_pane.pane_id;
  await herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle" });
  await herdrRpc("pane.report_agent_session", { pane_id: pane, source: "herdr:codex", agent: "codex", seq: 1, agent_session_id: native, session_start_source: "new" });
  app = createServer({ port: 0, hostname: "127.0.0.1", stateDir: root, token: "", sidecar: false, codexHome: join(root, "codex") });
  base = `http://127.0.0.1:${app.port}`;
  const devices = app.context.services.devices;
  const watcher = devices.pair(devices.startPairing().code, "Fixture watcher", "watch")!;
  watchCookie = `ovis_device=${encodeURIComponent(watcher.token)}`;
}, 15000);
afterAll(async () => { app?.stop(); if (workspace) await workspaceClose(workspace); rmSync(root, { recursive: true, force: true }); });

it("persists through authenticated HTTP, refuses stale revisions and never promotes raw native hints", async () => {
  const manager = app.context.services.core.machines!;
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout>;
  await new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Owned fixture roster did not arrive")), 12000);
    unsubscribe = manager.subscribe((event) => {
      if (event.type === "machines" && event.machines.some((machine) => machine.snapshot?.panes.some((item) => item.pane_id === pane && item.agent_session?.value === native))) resolve();
    });
    void manager.refreshLocal();
  }).finally(() => { unsubscribe(); clearTimeout(timer!); });
  const roster = await (await fetch(`${base}/api/machines`)).json() as MachineRoster;
  const machine = roster.machines.find((item) => item.id === "local")!;
  const selected = machine.snapshot!.panes.find((item) => item.pane_id === pane)!;
  expect(flockBinding(machine, selected)).toBeNull();
  const binding = { machine_id: machine.id, pane_id: pane, herdr_lifetime: machine.snapshot!.herdr_lifetime!, agent: "codex", native_session_id: native };
  const unproven = await fetch(`${base}/api/flock`, { method: "POST", headers: headers(), body: JSON.stringify({ revision: 0, command: { type: "adopt", name: "Unproven fixture", binding } }) });
  expect(unproven.status).toBe(409);
  const response = await fetch(`${base}/api/flock`, { method: "POST", headers: headers(), body: JSON.stringify({ revision: 0, command: { type: "create-work", name: "Fixture work" } }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const doc = await response.json() as FlockRegistry;
  expect(doc.executions).toEqual([]);
  expect(doc.works[0]!.name).toBe("Fixture work");
  const stale = await fetch(`${base}/api/flock`, { method: "POST", headers: headers(), body: JSON.stringify({ revision: 0, command: { type: "create-work", name: "Stale" } }) });
  expect(stale.status).toBe(409);
  // A cached report is not ownership proof, and closing its source cannot make it adoptable.
  const other = await workspaceCreate({ cwd: root, label: "ovis-test-flock-stale-source" });
  let closed = false;
  try {
    const otherPane = other.root_pane.pane_id;
    await herdrRpc("pane.report_agent", { pane_id: otherPane, source: "manual", agent: "codex", state: "idle" });
    await herdrRpc("pane.report_agent_session", { pane_id: otherPane, source: "herdr:codex", agent: "codex", seq: 1, agent_session_id: nextNative });
    const cached = { ...machine, snapshot: await app.context.services.core.clientSnapshot() };
    const unadoptedBinding = { ...binding, pane_id: otherPane, native_session_id: nextNative };
    await workspaceClose(other.workspace.workspace_id); closed = true;
    const staleRoster = spyOn(manager, "list").mockReturnValue([cached]);
    try {
      const replaced = await fetch(`${base}/api/flock`, { method: "POST", headers: headers(), body: JSON.stringify({ revision: doc.revision, command: { type: "adopt", name: "Ended execution", binding: unadoptedBinding } }) });
      expect(replaced.status).toBe(409);
      expect((await (await fetch(`${base}/api/flock`)).json() as FlockRegistry)).toEqual(doc);
    } finally { staleRoster.mockRestore(); }
  } finally { if (!closed) await workspaceClose(other.workspace.workspace_id); }
}, 15000);

it("enforces origin, custom-header, authentication, watch and manager-only boundaries", async () => {
  const body = JSON.stringify({ revision: 0, command: { type: "create-work", name: "Rejected" } });
  expect((await fetch(`${base}/api/flock`, { method: "POST", headers: { origin: "https://other.invalid", "x-herdr-machine": "1" }, body })).status).toBe(403);
  expect((await fetch(`${base}/api/flock`, { method: "POST", headers: { origin: base }, body })).status).toBe(403);
  for (const method of ["GET", "POST"]) expect((await fetch(`${base}/api/flock`, { method, headers: { ...headers(), cookie: watchCookie }, ...(method === "POST" ? { body } : {}) })).status).toBe(403);
  expect((await fetch(`${base}/api/session?flock=1`, { headers: { cookie: watchCookie } })).status).toBe(403);
  expect((await fetch(`${base}/api/machines/local/flock`)).status).toBe(400);
  // The dedicated bridge credential cannot read the manager's registry.
  const privateDir = mkdtempSync(join(root, "private-"));
  const privateApp = createServer({ port: 0, hostname: "127.0.0.1", stateDir: privateDir, token: "fixture-owner", bridgeToken: "fixture-bridge", machines: false, sidecar: false });
  try {
    const privateBase = `http://127.0.0.1:${privateApp.port}`;
    expect((await fetch(`${privateBase}/api/flock`)).status).toBe(401);
    expect((await fetch(`${privateBase}/api/flock`, { headers: { authorization: "Bearer fixture-bridge" } })).status).toBe(401);
  } finally { privateApp.stop(); }
});
