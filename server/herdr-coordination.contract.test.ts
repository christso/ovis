import { expect, it } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import type { HerdrCoordinationPage } from "../shared/graph-registry.ts";
import type { Machine } from "../shared/machines.ts";
import { graphRegistryInventory } from "../shared/graph-registry-inventory.ts";
import { graphRelationships } from "../shared/graph-relationships.ts";
import { graphInventory, graphTarget } from "../src/features/graph/graphInventory.ts";
import { GraphRegistryStore } from "./graph-registry.ts";
import { verifyGraphSnapshot } from "./graph-source.ts";
import { createServer } from "./index.ts";
import { herdrRpc, herdrSocketPath, workspaceClose, workspaceCreate } from "./herdr/client.ts";

/** Native fork CLI/daemon receipts; the two CLI programs and their reported UI state are owned stand-ins, not model sessions. */
it.skipIf(process.env["OVIS_HERDR_COORDINATION_TEST"] !== "1")("captures native Herdr CLI operations through Ovis and Graph without manual link ingestion", async () => {
  const config = process.env["XDG_CONFIG_HOME"], socket = herdrSocketPath(), binary = process.env["OVIS_HERDR_BIN"];
  if (!config || !process.env["HERDR_TEST_SESSION"]?.startsWith("check-") || !resolve(socket).startsWith(resolve(config) + sep)) throw new Error("Native coordination qualification must run through bun run check run in its disposable Herdr session");
  if (!binary || !Bun.which(binary)) throw new Error("OVIS_HERDR_BIN must name the custom coordination producer binary");
  const root = mkdtempSync(join(tmpdir(), "ovis-native-coordination-")), bin = join(root, "bin"), home = join(root, "codex-home"), log = join(root, "received.bin");
  mkdirSync(bin); mkdirSync(home);
  const executable = join(bin, "codex"), program = join(root, "agent.cjs");
  copyFileSync(process.execPath, executable); chmodSync(executable, 0o700);
  writeFileSync(program, `const fs=require('node:fs');process.stdout.write('COORDINATION_STANDIN_READY\\nOpenAI Codex (v0.166.0)\\n› \\n');if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',bytes=>{fs.appendFileSync(process.argv[2],bytes);process.stdout.write('› \\n');});setInterval(()=>{},1000);\n`);
  const owned: string[] = [], children: { kill(): void; exitCode: number | null }[] = [];
  let app: ReturnType<typeof createServer> | undefined;
  const quote = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'";
  const list = () => herdrRpc<HerdrCoordinationPage>("agent.coordination.list", { limit: 500 });
  const ready = (pane: string, targetSocket?: string) => herdrRpc("pane.wait_for_output", { pane_id: pane, match: { type: "substring", value: "COORDINATION_STANDIN_READY" }, source: "recent", timeout_ms: 15000 }, targetSocket);
  const idle = (pane: string, targetSocket?: string) => herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle" }, targetSocket);
  function cli(args: string[], caller: string) {
    const process = Bun.spawn([binary!, ...args], { env: { ...globalThis.process.env, HERDR_ENV: "1", HERDR_PANE_ID: caller, HERDR_SOCKET_PATH: socket }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(process);
    const done = (async () => {
      const timer = setTimeout(() => { if (process.exitCode === null) process.kill(); }, 20000);
      try {
        const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
        const text = stdout.trim() || stderr.trim();
        return { exit, body: JSON.parse(text) as { result?: { agent?: { terminal_id: string } }; error?: { code: string } }, stdout, stderr };
      } finally { clearTimeout(timer); }
    })();
    return { done };
  }
  try {
    const capability = await list();
    expect(capability.version).toBe(1); expect(capability.server_id.length).toBeGreaterThan(0);
    const environment = { PATH: [bin, process.env["PATH"]].filter(Boolean).join(delimiter), CODEX_HOME: home };
    const source = await workspaceCreate({ cwd: root, label: "ovis-test-native-coordination-source", env: environment });
    owned.push(source.workspace.workspace_id);
    const target = await workspaceCreate({ cwd: root, label: "ovis-test-native-coordination-target", env: environment });
    owned.push(target.workspace.workspace_id);
    const sourcePane = source.root_pane.pane_id, targetPane = target.root_pane.pane_id;
    await herdrRpc("pane.send_text", { pane_id: sourcePane, text: `${[executable, program, log].map(quote).join(" ")}\n` });
    await ready(sourcePane); await idle(sourcePane);
    const sourceEndpoint = (await list()).agents.find((agent) => agent.terminal_id === source.root_pane.terminal_id)!;
    expect(sourceEndpoint).toBeDefined();
    const name = `owned_worker_${Date.now().toString(36)}`;
    const start = cli(["agent", "start", name, "--kind", "codex", "--pane", targetPane, "--", program, log], sourcePane);
    await ready(targetPane); await idle(targetPane);
    const started = await start.done;
    expect({ exit: started.exit, error: started.body.error, stderr: started.stderr }).toEqual({ exit: 0, error: undefined, stderr: "" });
    const afterStart = await list(), childEndpoint = afterStart.agents.find((agent) => agent.terminal_id === target.root_pane.terminal_id)!;
    expect(childEndpoint).toBeDefined();
    const ownReceipts = (page: HerdrCoordinationPage) => page.receipts.filter((receipt) => receipt.source.agent_instance_id === sourceEndpoint.agent_instance_id);
    expect(ownReceipts(afterStart).map((receipt) => receipt.kind)).toEqual(["delegation"]);
    expect(ownReceipts(afterStart)[0]!.target.agent_instance_id).toBe(childEndpoint.agent_instance_id);
    const prompt = "owned message whose content must not enter the relationship registry";
    expect((await cli(["agent", "prompt", name, prompt], sourcePane).done).exit).toBe(0);
    // The message is submitted, but the stand-in never reports a working transition. A later wait timeout must retain its successful write receipt.
    const waited = await cli(["agent", "prompt", name, "owned wait-timeout message", "--wait", "--timeout", "2000"], sourcePane).done;
    expect(waited.exit).toBe(1); expect(waited.body.error?.code).toBe("timeout");
    const failed = await cli(["agent", "prompt", "owned_missing_target", "never submit this"], sourcePane).done;
    expect(failed.exit).toBe(1);
    const recorded = ownReceipts(await list());
    expect(recorded.map((receipt) => receipt.kind)).toEqual(["delegation", "communication", "communication"]);
    expect(new Set(recorded.map((receipt) => receipt.id)).size).toBe(3);
    expect(JSON.stringify(recorded)).not.toContain(prompt);
    expect(JSON.stringify(recorded)).not.toContain("owned wait-timeout message");

    app = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "app"), machines: false, sidecar: false, codexHome: home });
    const read = () => verifyGraphSnapshot(() => app!.context.services.core.clientSnapshot(), home);
    const machine = async (): Promise<Machine> => ({ id: "owned-native-producer", name: "Owned native producer", kind: "local", enabled: true, state: "connected", error: null, snapshot: await read() });
    const store = new GraphRegistryStore(join(root, "registry")), live = await machine();
    const registry = store.observe([live]);
    expect(registry.observations?.filter((event) => event.source === "herdr")).toHaveLength(3);
    expect(registry.executions).toHaveLength(0);
    const relationships = graphRelationships(registry), delegation = relationships.find((relation) => relation.kind === "delegation")!;
    expect(delegation.source.herdr?.agent_instance_id).toBe(sourceEndpoint.agent_instance_id);
    expect(delegation.target.herdr?.agent_instance_id).toBe(childEndpoint.agent_instance_id);
    expect(relationships.find((relation) => relation.kind === "communication")?.count).toBe(2);
    const rows = graphRegistryInventory(registry, [live]), graph = graphInventory(registry, rows, [live]);
    expect(graph.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(1);
    expect(graph.edges.find((edge) => edge.kind === "communication")?.eventCount).toBe(2);
    const targetNode = graph.nodes.find((node) => node.kind === "terminal" && graphTarget(registry, rows, node.id, [live])?.pane_id === targetPane)!;
    expect(targetNode).toBeDefined();
    expect(graph.edges.find((edge) => edge.kind === "delegation")?.target).toBe(targetNode.id);
    expect(graphTarget(registry, rows, targetNode.id, [live])).toEqual({ machine_id: live.id, pane_id: targetPane });
    const revision = registry.revision;
    expect(store.observe([await machine()]).revision).toBe(revision);
    expect(new GraphRegistryStore(join(root, "registry")).read().observations).toHaveLength(3);
    await workspaceClose(target.workspace.workspace_id); owned.pop();
    const closed = await machine(), retained = store.observe([closed]);
    expect(retained.observations).toHaveLength(3);
    const closedRows = graphRegistryInventory(retained, [closed]), closedGraph = graphInventory(retained, closedRows, [closed]);
    expect(graphTarget(retained, closedRows, targetNode.id, [closed])).toBeNull();
    expect(closedGraph.nodes.some((node) => node.id === targetNode.id)).toBe(false);
    expect(closedGraph.nodes.flatMap((node) => node.activity ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "delegation", direction: "outgoing", eventCount: 1 }),
      expect.objectContaining({ kind: "communication", direction: "outgoing", eventCount: 2 }),
    ]));
    expect(ownReceipts(await list())).toHaveLength(3);
    expect(readFileSync(log, "utf8")).toContain(prompt);

    // The inherited caller belongs to the origin daemon, even when --session routes to another namespace.
    const remoteSession = `${process.env["HERDR_TEST_SESSION"]}-remote`;
    const remoteSocket = join(config, "herdr", "sessions", remoteSession, "herdr.sock");
    const remote = Bun.spawn([binary, "--session", remoteSession, "server"], {
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("HERDR_"))),
      cwd: root, stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    children.push(remote);
    const reader = remote.stderr.getReader();
    const startup = (async () => {
      let text = "";
      while (!text.includes(`api socket: ${remoteSocket}`)) {
        const part = await reader.read();
        if (part.done) throw new Error(`Owned second daemon exited before startup: ${text}`);
        text += new TextDecoder().decode(part.value);
      }
    })();
    const deadline = setTimeout(() => { if (remote.exitCode === null) remote.kill(); }, 15000);
    try { await startup; } catch (error) { reader.releaseLock(); throw error; } finally { clearTimeout(deadline); }
    const drained = (async () => {
      try { while (!(await reader.read()).done) { /* drain this owned daemon's remaining diagnostics */ } }
      finally { reader.releaseLock(); }
    })();
    try {
      const remoteWorkspace = await herdrRpc<Awaited<ReturnType<typeof workspaceCreate>>>("workspace.create", { cwd: root, label: "ovis-test-native-coordination-other-server", env: environment }, remoteSocket);
      const remotePane = remoteWorkspace.root_pane.pane_id;
      const remoteName = `${name}_remote`;
      const remoteStart = cli(["--session", remoteSession, "agent", "start", remoteName, "--kind", "codex", "--pane", remotePane, "--", program, log], sourcePane);
      await ready(remotePane, remoteSocket); await idle(remotePane, remoteSocket);
      expect((await remoteStart.done).exit).toBe(0);
      expect((await cli(["--session", remoteSession, "agent", "prompt", remoteName, "owned cross-namespace message"], sourcePane).done).exit).toBe(0);
      const remotePage = await herdrRpc<HerdrCoordinationPage>("agent.coordination.list", { limit: 500 }, remoteSocket);
      expect(remotePage.server_id).not.toBe(sourceEndpoint.server_id);
      const crossNamespace = ownReceipts(await list()).filter((receipt) => receipt.target.server_id === remotePage.server_id);
      expect(crossNamespace.map((receipt) => receipt.kind)).toEqual(["delegation", "communication"]);
      expect(crossNamespace.every((receipt) => receipt.source.server_id === sourceEndpoint.server_id)).toBe(true);
      expect(crossNamespace.every((receipt) => receipt.target.terminal_id === remoteWorkspace.root_pane.terminal_id)).toBe(true);
      expect(remotePage.receipts).toHaveLength(0);
      const afterForward = store.observe([await machine()]);
      expect(afterForward.observations).toHaveLength(5);
      const remoteRelation = graphRelationships(afterForward).find((relation) => relation.kind === "delegation" && relation.target.herdr?.server_id === remotePage.server_id)!;
      expect(remoteRelation.source.herdr?.server_id).toBe(sourceEndpoint.server_id);
      const current = await machine(), currentRows = graphRegistryInventory(afterForward, [current]);
      const currentGraph = graphInventory(afterForward, currentRows, [current]);
      expect(graphTarget(afterForward, currentRows, remoteRelation.target.id, [current])).toBeNull();
      expect(currentGraph.nodes.some((node) => node.id === remoteRelation.target.id)).toBe(false);
      expect(currentGraph.edges.filter((edge) => edge.kind === "delegation" || edge.kind === "communication")).toHaveLength(0);
      expect(currentGraph.nodes.flatMap((node) => node.activity ?? []).filter((item) => item.endpointId === remoteRelation.target.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "delegation", direction: "outgoing", eventCount: 1 }),
        expect.objectContaining({ kind: "communication", direction: "outgoing", eventCount: 1 }),
      ]));
    } finally {
      await herdrRpc("server.stop", {}, remoteSocket).catch(() => { if (remote.exitCode === null) remote.kill(); });
      await remote.exited; await drained;
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    app?.stop();
    for (const workspace of owned.reverse()) await workspaceClose(workspace).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}, 90000);
