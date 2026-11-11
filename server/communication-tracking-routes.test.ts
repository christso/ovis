import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommunicationTrackingStatus } from "../shared/communication-tracking.ts";
import { createServer } from "./index.ts";
import { CommunicationTrackingSetupChanged, type CommunicationTrackingService } from "./communication-tracking.ts";
import { handleMachineRequest } from "./machine-api.ts";
import type { MachineManager } from "./machines.ts";

describe("communication tracking HTTP contract", () => {
  const token = "tracking-browser-token", bridge = "b".repeat(64), watch = "w".repeat(64);
  let server: ReturnType<typeof createServer>, root: string;
  let mutations: string[] = [];
  let state: CommunicationTrackingStatus = { state: "disabled", shell: "/bin/bash", profiles: ["/fixture/.bashrc"], detail: null, can_manage: true };
  const service: CommunicationTrackingService = {
    status: async () => state,
    enable: async (expected) => {
      if (JSON.stringify(expected) !== JSON.stringify({ shell: state.shell, profiles: state.profiles })) throw new CommunicationTrackingSetupChanged();
      mutations.push("enable"); return state = { ...state, state: "enabled" };
    },
    disable: async () => { mutations.push("disable"); return state = { ...state, state: "disabled" }; },
  };
  const url = (path = "/api/agents/communication-tracking") => `http://127.0.0.1:${server.port}${path}`;
  const request = (path = "/api/agents/communication-tracking", method = "GET", credential = token, extra: Record<string, string> = {}) => fetch(url(path), {
    method, headers: { authorization: `Bearer ${credential}`, origin: url(""), "x-herdr-machine": "1", ...extra }, ...(method === "POST" ? { body: JSON.stringify({shell: state.shell, profiles: state.profiles}) } : {}),
  });
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ovis-tracking-route-"));
    writeFileSync(join(root, "devices.json"), JSON.stringify({ gate_closed_at: new Date().toISOString(), devices: [{ id: "0123456789abcdef", label: "Watch fixture", role: "watch", token_hash: createHash("sha256").update(watch).digest("hex"), created_at: new Date().toISOString(), last_seen_at: null }] }), { mode: 0o600 });
    server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: root, token, bridgeToken: bridge, sidecar: false, tailscaleOwner: null, herdrProfiles: async () => [], communicationTracking: service });
  });
  afterAll(() => { server.stop(); rmSync(root, { recursive: true, force: true }); });

  it("reads without writes, enables after explicit app request, and disables through the local alias", async () => {
    mutations = [];
    const status = await request();
    expect(status.status).toBe(200); expect(status.headers.get("cache-control")).toBe("no-store");
    expect(await status.json()).toEqual(state); expect(mutations).toEqual([]);
    expect((await (await request(undefined, "POST")).json() as CommunicationTrackingStatus).state).toBe("enabled");
    expect((await (await request("/api/machines/local/agents/communication-tracking", "DELETE")).json() as CommunicationTrackingStatus).state).toBe("disabled");
    expect(mutations).toEqual(["enable", "disable"]);
  });

  it("refuses missing credentials, watchers, cross-site writes, missing app header, queries and arbitrary settings", async () => {
    mutations = [];
    expect((await fetch(url())).status).toBe(401);
    for (const path of ["/api/agents/communication-tracking", "/api/machines/local/agents/communication-tracking"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await fetch(url(path), { method, headers: { cookie: `ovis_device=${watch}`, "x-forwarded-for": "100.64.0.9", origin: url(""), "x-herdr-machine": "1" }, ...(method === "POST" ? { body: JSON.stringify({shell: state.shell, profiles: state.profiles}) } : {}) });
        expect([response.status, (await response.json() as { error: { code: string } }).error.code]).toEqual([403, "read_only"]);
      }
      expect((await request(path, "POST", token, { "x-herdr-machine": "" })).status).toBe(403);
      expect((await request(path, "DELETE", token, { origin: "https://other.invalid" })).status).toBe(403);
    }
    expect((await request("/api/agents/communication-tracking?directory=/arbitrary", "POST")).status).toBe(400);
    const arbitrary = await fetch(url(), { method: "POST", headers: { authorization: `Bearer ${token}`, origin: url(""), "x-herdr-machine": "1" }, body: JSON.stringify({ directory: "/arbitrary" }) });
    expect(arbitrary.status).toBe(400);
    expect((await request(undefined, "PUT")).status).toBe(400);
    const changed = await fetch(url(), { method: "POST", headers: { authorization: `Bearer ${token}`, origin: url(""), "x-herdr-machine": "1" }, body: JSON.stringify({ shell: "/bin/zsh", profiles: ["/fixture/.zshrc"] }) });
    expect([changed.status, (await changed.json() as { error: { code: string } }).error.code]).toEqual([409, "setup_changed"]);
    expect(mutations).toEqual([]);
  });

  it("preserves owner and watch restrictions through a remote proxy before lending its bridge token", async () => {
    mutations = [];
    const manager = { endpoint: (id: string) => id === "remote" ? { url: url(""), token: bridge } : null, trackTerminal: () => () => {} } as unknown as MachineManager;
    const remote = (method: string, owner: boolean, watching = false) => handleMachineRequest(new Request("http://127.0.0.1/api/machines/remote/agents/communication-tracking", {
      method, headers: { "x-herdr-machine": "1" }, ...(method === "POST" ? { body: JSON.stringify({shell: state.shell, profiles: state.profiles}) } : {}),
    }), manager, undefined, undefined, watching, undefined, undefined, undefined, undefined, owner);
    expect((await remote("POST", false)).status).toBe(403);
    expect((await remote("GET", true, true)).status).toBe(403);
    expect((await remote("GET", true)).status).toBe(200);
    expect((await (await remote("GET", false)).json() as CommunicationTrackingStatus).can_manage).toBe(false);
    expect(mutations).toEqual([]);
    expect((await (await remote("POST", true)).json() as CommunicationTrackingStatus).state).toBe("enabled");
    expect((await (await remote("DELETE", true)).json() as CommunicationTrackingStatus).state).toBe("disabled");
    expect(mutations).toEqual(["enable", "disable"]);
  });
});
