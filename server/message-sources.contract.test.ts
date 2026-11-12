import { expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceStore } from "./devices.ts";
import { createServer } from "./index.ts";
import * as conversation from "./conversation.ts";
import * as cli from "./herdr/cli-observations.ts";
import { preparePeerMessage, publishPeerMessage } from "./message-sources.ts";

it("serves authenticated peer attribution and invalidates a pre-publication conversation ETag", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-http-"));
  const source = { server_id: "fictional-server", boot_id: "fictional-boot", terminal_id: "source", agent_instance_id: "source-process", pane_id: "source-pane", agent: "codex", name: "Worker" };
  const target = { ...source, terminal_id: "recipient", agent_instance_id: "recipient-process", pane_id: "recipient-pane", agent: "omp" };
  const prepared = preparePeerMessage("original body\nΩ", source, target, root, "Graph worktree projection")!;
  const turn = { role: "user" as const, ts: null, parts: [{ kind: "text" as const, text: prepared.text }] };
  const read = spyOn(conversation, "paneConversation").mockImplementation(async () => ({ source: "codex-transcript", turns: [turn], metadata: { model: null, reasoning_effort: null }, cursor: null, history_id: "native-fixture", version: "native-fixture-version" }));
  // Only native transcript/process identification is fictional; HTTP, authentication and disk proofs are real.
  const endpoint = spyOn(cli, "herdrCliEndpoint").mockResolvedValue(target);
  const devices = new DeviceStore(join(root, "server"));
  const watching = devices.pair(devices.startPairing().code, "Watch fixture", "watch")!;
  devices.match(watching.token);
  const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: join(root, "server"), messageSourcesDirectory: root, token: "peer-fixture-owner", tailscaleOwner: null });
  const ask = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("cookie")) headers.set("authorization", "Bearer peer-fixture-owner");
    return fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers });
  };
  const path = "/api/pane/conversation?pane_id=recipient-pane";
  try {
    const before = await ask(path), etag = before.headers.get("etag")!;
    expect((await before.json()).turns[0].sender).toBeUndefined();
    publishPeerMessage(prepared, root);
    const after = await ask(path, { headers: { "if-none-match": etag } });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect((await after.json()).turns[0]).toMatchObject({ sender: { id: prepared.id, name: "Graph worktree projection", agent: "codex" }, parts: [{ kind: "text", text: "original body\nΩ" }] });
    expect((await ask(path, { headers: { "if-none-match": after.headers.get("etag")! } })).status).toBe(304);
    expect(await (await ask(`/api/pane/message-source?id=${prepared.id}`)).json()).toEqual({ sender: { id: prepared.id, source } });
    expect(await (await ask("/api/pane/message-source?id=unknown")).json()).toEqual({ sender: null });
    expect((await ask("/api/pane/message-source/resolve?source=%7B%7D")).status).toBe(400);
    expect((await ask(`/api/pane/message-source?id=${prepared.id}`, { method: "POST" })).status).toBe(400);
    const watchHeaders = { cookie: `ovis_device=${watching.token}` };
    for (const prefix of ["/api", "/api/machines/fictional"]) {
      for (const suffix of ["message-source", "message-source/resolve"]) expect((await ask(`${prefix}/pane/${suffix}`, { headers: watchHeaders })).status).toBe(403);
    }
    const watched = await ask(path, { headers: watchHeaders });
    expect(watched.status).toBe(200);
    expect((await watched.json()).turns[0]).toMatchObject({ parts: [{ kind: "text", text: prepared.text }] });
    endpoint.mockResolvedValue({ ...target, agent_instance_id: "replacement" });
    const replaced = await ask(path, { headers: { "if-none-match": after.headers.get("etag")! } });
    expect(replaced.status).toBe(200);
    expect((await replaced.json()).turns[0].sender).toBeUndefined();
  } finally { server.stop(); endpoint.mockRestore(); read.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});
