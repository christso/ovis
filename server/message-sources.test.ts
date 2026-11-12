import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePeerMessage, publishPeerMessage, peerMessageTurn, readPeerMessage } from "./message-sources.ts";
import legacy from "./fixtures/message-source-v1.json";
import type { HerdrCoordinationEndpoint } from "../shared/graph-registry.ts";

const source: HerdrCoordinationEndpoint = { server_id: "source-server", boot_id: "boot", terminal_id: "source-terminal", agent_instance_id: "source-process", pane_id: "w1:p1", agent: "codex", name: "worker\n\u001b[31m" };
const target = { ...source, server_id: "target-server", terminal_id: "target-terminal", agent_instance_id: "target-process", pane_id: "w2:p1", agent: "omp", name: "receiver" };

it("authenticates each exact delivered peer body against its recipient without journaling content", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-"));
  try {
    const body = "  original <content>\n\nquotes ' Ω\n";
    const first = preparePeerMessage(body, source, target, root)!;
    const second = preparePeerMessage(body, source, target, root)!;
    expect(first.id).not.toBe(second.id);
    expect(first.text).toContain(body);
    expect(first.text).toContain("Peer agent content");
    expect(first.text).not.toContain("\u001b");
    const turn = { role: "user" as const, ts: null, parts: [{ kind: "text" as const, text: first.text }] };
    expect(peerMessageTurn(turn, target, root)).toEqual(turn);
    publishPeerMessage(first, root);
    publishPeerMessage(second, root);
    const concurrent = peerMessageTurn({ ...turn, parts: [{ kind: "text", text: second.text }] }, target, root);
    expect(concurrent.sender?.id).toBe(second.id);
    expect(concurrent.parts).toEqual([{ kind: "text", text: body }]);
    expect(peerMessageTurn(turn, target, root)).toMatchObject({ sender: { id: first.id, name: "worker  [31m" }, parts: [{ kind: "text", text: body }] });
    expect(peerMessageTurn({ ...turn, parts: [{ kind: "text", text: first.text.replace("original", "imitation") }] }, target, root).sender).toBeUndefined();
    expect(peerMessageTurn(turn, { ...target, agent_instance_id: "replacement" }, root).sender).toBeUndefined();
    expect(peerMessageTurn({ ...turn, role: "assistant" }, target, root).sender).toBeUndefined();
    expect(peerMessageTurn({ ...turn, parts: [{ kind: "text", text: body }] }, target, root).sender).toBeUndefined();
    // A verbatim copy proves only the original peer content; it never gets a new send identity.
    expect(peerMessageTurn({ ...turn, ts: "later copied row" }, target, root).sender?.id).toBe(first.id);
    expect(readPeerMessage("../key", root)).toBeNull();
    const path = join(root, "messages", `${first.id}.json`), original = readFileSync(path, "utf8");
    const forged = JSON.parse(original); forged.source.terminal_id = "unrelated";
    writeFileSync(path, JSON.stringify(forged));
    expect(readPeerMessage(first.id, root)).toBeNull();
    writeFileSync(path, "{malformed");
    expect(peerMessageTurn(turn, target, root).sender).toBeUndefined();
    for (const name of readdirSync(join(root, "messages"))) expect(readFileSync(join(root, "messages", name)).includes(Buffer.from(body))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32" || !Bun.which("mkfifo"))("treats non-regular journal files as unavailable instead of blocking delivery or HTTP", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-fifo-"));
  try {
    const directory = join(root, "messages"); mkdirSync(directory, { mode: 0o700 });
    expect(Bun.spawnSync(["mkfifo", "-m", "600", join(directory, "key")]).exitCode).toBe(0);
    expect(preparePeerMessage("unchanged passthrough", source, target, root)).toBeNull();
    rmSync(join(directory, "key"));
    const prepared = preparePeerMessage("original", source, target, root)!;
    expect(prepared).not.toBeNull();
    expect(Bun.spawnSync(["mkfifo", "-m", "600", join(directory, `${prepared.id}.json`)]).exitCode).toBe(0);
    expect(readPeerMessage(prepared.id, root)).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("correlates simultaneous identical first sends across independent shim processes", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-concurrent-"));
  try {
    const program = `import { preparePeerMessage,publishPeerMessage } from ${JSON.stringify(new URL("./message-sources.ts", import.meta.url).href)};
const prepared=preparePeerMessage("identical concurrent body",${JSON.stringify(source)},${JSON.stringify(target)},${JSON.stringify(root)});
if(!prepared)process.exit(1);publishPeerMessage(prepared,${JSON.stringify(root)});console.log(JSON.stringify({id:prepared.id,text:prepared.text}));`;
    const sends = await Promise.all(Array.from({ length: 6 }, async () => {
      const child = Bun.spawn([process.execPath, "--eval", program], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      return JSON.parse(stdout) as { id: string; text: string };
    }));
    expect(new Set(sends.map((send) => send.id)).size).toBe(6);
    for (const send of sends) expect(peerMessageTurn({ role: "user", ts: null, parts: [{ kind: "text", text: send.text }] }, target, root)).toMatchObject({ sender: { id: send.id }, parts: [{ kind: "text", text: "identical concurrent body" }] });
    expect(readdirSync(join(root, "messages")).filter((name) => name.endsWith(".json"))).toHaveLength(6);
    expect(readdirSync(join(root, "messages")).some((name) => name.endsWith(".tmp"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


it("authenticates the historical display name separately from the source process and kind", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-name-"));
  try {
    const prepared = preparePeerMessage("body unchanged", source, target, root, "Graph worktree projection")!;
    publishPeerMessage(prepared, root);
    const turn = { role: "user" as const, ts: null, parts: [{ kind: "text" as const, text: prepared.text }] };
    expect(prepared.text).toContain("from Graph worktree projection (codex)");
    expect(peerMessageTurn(turn, target, root).sender).toEqual({ id: prepared.id, name: "Graph worktree projection", agent: "codex" });
    expect(readPeerMessage(prepared.id, root)?.source).toEqual(source);
    const renamed = preparePeerMessage("later body", source, target, root, "Renamed release coordinator")!;
    publishPeerMessage(renamed, root);
    expect(peerMessageTurn({ ...turn, parts: [{ kind: "text", text: renamed.text }] }, target, root).sender?.name).toBe("Renamed release coordinator");
    expect(peerMessageTurn(turn, target, root).sender?.name).toBe("Graph worktree projection");
    expect(readPeerMessage(renamed.id, root)?.source).toEqual(source);
    const path = join(root, "messages", `${prepared.id}.json`);
    const forged = JSON.parse(readFileSync(path, "utf8"));
    forged.display_name = "Forged title";
    writeFileSync(path, JSON.stringify(forged));
    expect(peerMessageTurn(turn, target, root).sender).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});


it("reads a fixed signed receipt and envelope produced by the pre-display-name implementation", () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-peer-legacy-"));
  try {
    mkdirSync(join(root, "messages"), { mode: 0o700 });
    writeFileSync(join(root, "messages", "key"), Buffer.from(legacy.secret, "hex"), { mode: 0o600 });
    writeFileSync(join(root, "messages", `${legacy.id}.json`), JSON.stringify(legacy.receipt), { mode: 0o600 });
    const turn = { role: "user" as const, ts: null, parts: [{ kind: "text" as const, text: legacy.text }] };
    expect(readPeerMessage(legacy.id, root)).toEqual({ ...legacy.receipt, version: 1 });
    expect(peerMessageTurn(turn, legacy.receipt.target, root)).toEqual({ ...turn, parts: [{ kind: "text", text: legacy.body }], sender: { id: legacy.id, name: "Legacy worker", agent: "codex" } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
