import { expect, it } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import type { Machine } from "../shared/machines.ts";
import { graphRegistryInventory } from "../shared/graph-registry-inventory.ts";
import { graphHerdrEndpointKey, graphRelationships } from "../shared/graph-relationships.ts";
import { graphInventory, graphTarget } from "../src/features/graph/graphInventory.ts";
import { GraphRegistryStore } from "./graph-registry.ts";
import { CommunicationTracking } from "./communication-tracking.ts";
import { verifyGraphSnapshot } from "./graph-source.ts";
import { finishHerdrIdentity, herdrLifetime } from "./finishes.ts";
import { herdrCliEndpoint, herdrCliObservations } from "./herdr/cli-observations.ts";
import { herdrRpc, herdrSocketPath, sessionSnapshot, workspaceClose, workspaceCreate } from "./herdr/client.ts";

/** Real stock CLI/daemon, with recognized owned CLI stand-ins rather than model/API sessions. */
it.skipIf(process.platform === "win32")("captures stock Herdr through PATH while Ovis is absent, replays once and rejects replacement occupants", async () => {
  const config = process.env["XDG_CONFIG_HOME"], socket = herdrSocketPath(), binary = process.env["OVIS_HERDR_BIN"] || Bun.which("herdr");
  if (!config || !process.env["HERDR_TEST_SESSION"]?.startsWith("check-") || !resolve(socket).startsWith(resolve(config) + sep)) throw new Error("Run through bun run check run in its disposable Herdr session");
  if (!binary) throw new Error("Herdr CLI qualification requires an installed binary");
  const root = mkdtempSync(join(tmpdir(), "ovis-herdr-cli-contract-")), bin = join(root, "bin"), journal = join(root, "journal"), home = join(root, "codex-home"), log = join(root, "received.bin"), wrapper = join(root, "shim");
  mkdirSync(bin); mkdirSync(home);
  const executable = join(bin, "codex"), program = join(root, "agent.cjs");
  copyFileSync(process.execPath, executable); chmodSync(executable, 0o700);
  writeFileSync(program, `const fs=require('node:fs');process.stdout.write('SHIM_READY_'+process.argv[3]+'\\nOpenAI Codex (v0.166.0)\\n› \\n');if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',bytes=>{if(bytes.includes(3)){process.stdout.write('SHIM_AGENT_EXITED\\n');process.exit(0)}fs.appendFileSync(process.argv[2],bytes);process.stdout.write('› \\n');});setInterval(()=>{},1000);\n`);
  const quote = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'";
  const owned: string[] = [], children: ReturnType<typeof Bun.spawn>[] = [];
  const beforeJournal = process.env["OVIS_HERDR_CLI_DIR"];
  const invoke = (command: string[], caller: string, extra: Record<string, string> = {}) => {
    const child = Bun.spawn(["herdr", ...command], { env: { ...process.env, PATH: [wrapper, bin, process.env["PATH"]].filter(Boolean).join(delimiter), HERDR_ENV: "1", HERDR_PANE_ID: caller, HERDR_SOCKET_PATH: socket, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(child);
    return (async () => { const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, code }; })();
  };
  const ready = (pane: string, marker: string, targetSocket = socket) => herdrRpc("pane.wait_for_output", { pane_id: pane, match: { type: "substring", value: `SHIM_READY_${marker}` }, source: "recent", timeout_ms: 15000 }, targetSocket);
  const idle = (pane: string, targetSocket = socket) => herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state: "idle" }, targetSocket);
  const snapshot = async () => ({ ...await sessionSnapshot(), herdr_lifetime: herdrLifetime(finishHerdrIdentity(socket)!) });
  try {
    const install = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/herdr-shim.ts"), "install", "--real", binary, "--directory", wrapper, "--journal", journal], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect({ code: await install.exited, stderr: await new Response(install.stderr).text() }).toEqual({ code: 0, stderr: "" });
    const environment = { PATH: [bin, wrapper, process.env["PATH"]].filter(Boolean).join(delimiter), CODEX_HOME: home };
    const source = await workspaceCreate({ cwd: root, label: "ovis-test-shim-source", env: environment }); owned.push(source.workspace.workspace_id);
    const target = await workspaceCreate({ cwd: root, label: "ovis-test-shim-target", env: environment }); owned.push(target.workspace.workspace_id);
    const sourcePane = source.root_pane.pane_id, targetPane = target.root_pane.pane_id;
    await herdrRpc("pane.send_text", { pane_id: sourcePane, text: `${[executable, program, log, "source"].map(quote).join(" ")}\n` });
    await ready(sourcePane, "source"); await idle(sourcePane);
    const name = `shim_worker_${Date.now().toString(36)}`;
    const start = invoke(["agent", "start", name, "--kind", "codex", "--pane", targetPane, "--", program, log, "first"], sourcePane);
    await ready(targetPane, "first"); await idle(targetPane);
    expect(await start).toMatchObject({ code: 0, stderr: "" });
    const message = "offline message 'quoted' \"double\" $HOME `literal`\nsecond line Ω";
    expect(await invoke(["agent", "prompt", name, message], sourcePane)).toMatchObject({ code: 0, stderr: "" });
    const waited = await invoke(["agent", "prompt", name, "SHIM_WAIT_TIMEOUT_PROBE", "--wait", "--timeout", "1500"], sourcePane);
    expect(waited.code).toBe(1); expect(JSON.parse(waited.stderr).error).toEqual({ code: "timeout", message: "timed out waiting for agent status" });
    expect((await invoke(["agent", "prompt", "shim_absent_target", "never submit"], sourcePane)).code).toBe(1);
    const received = readFileSync(log, "utf8");
    expect(received).toContain(message); expect(received.split("SHIM_WAIT_TIMEOUT_PROBE")).toHaveLength(2); expect(received).not.toContain("never submit");
    const page = await herdrCliObservations(socket, journal);
    expect(page?.receipts.every((item) => item.producer === "herdr-cli" && item.scope === "terminal")).toBe(true); expect(page?.receipts.map((item) => item.kind).sort()).toEqual(["communication", "communication", "delegation"]);
    expect(JSON.stringify(page)).not.toContain(message); expect(JSON.stringify(page)).not.toContain("SHIM_WAIT_TIMEOUT_PROBE");
    const namespace = readdirSync(journal)[0]!;
    expect(readdirSync(join(journal, namespace)).filter((name) => name.endsWith(".json") && name !== "identity.json")).toHaveLength(3);
    // No Ovis process has been started. Its bridge can import the durable records later.
    process.env["OVIS_HERDR_CLI_DIR"] = journal;
    const machine = async (): Promise<Machine> => ({ id: "owned-stock-cli", name: "Owned stock CLI", kind: "local", enabled: true, state: "connected", error: null, snapshot: await verifyGraphSnapshot(snapshot, home) });
    const store = new GraphRegistryStore(join(root, "registry")), live = await machine(), registry = store.observe([live]);
    expect(registry.cli_observations).toHaveLength(3); expect(registry.cli_observations?.every((event) => event.producer === "herdr-cli" && event.scope === "terminal")).toBe(true);
    expect(registry.executions).toHaveLength(0); expect(registry.herdr_associations).toBeUndefined();
    const relations = graphRelationships(registry);
    expect(relations.find((item) => item.kind === "communication")?.count).toBe(2);
    expect(relations.every((item) => item.sources.includes("herdr-cli"))).toBe(true);
    const rows = graphRegistryInventory(registry, [live]), graph = graphInventory(registry, rows, [live]);
    const targetNode = graph.nodes.find((node) => node.kind === "terminal" && graphTarget(registry, rows, node.id, [live])?.pane_id === targetPane)!;
    expect(targetNode).toBeDefined(); expect(targetNode.freshness).toBe("live"); expect(targetNode.status).toBe("idle");
    expect(graph.edges.filter((edge) => edge.kind === "communication")).toHaveLength(1); expect(graph.edges.filter((edge) => edge.kind === "delegation")).toHaveLength(1);
    expect(store.observe([await machine()]).revision).toBe(registry.revision);
    expect(new GraphRegistryStore(join(root, "registry")).read().cli_observations).toHaveLength(3);
    const cancelled = invoke(["agent", "prompt", name, "SHIM_SIGNAL_PROBE", "--wait", "--timeout", "60000"], sourcePane);
    const cancelChild = children[children.length - 1]!;
    for (const deadline = Date.now() + 10000; !readFileSync(log, "utf8").includes("SHIM_SIGNAL_PROBE");) {
      if (Date.now() > deadline) throw new Error("Owned cancellation prompt did not arrive");
      await herdrRpc("pane.read", { pane_id: targetPane, source: "recent", strip_ansi: true });
    }
    cancelChild.kill("SIGTERM"); await cancelled;
    expect(cancelChild.signalCode).toBe("SIGTERM");
    expect(readFileSync(log, "utf8").split("SHIM_SIGNAL_PROBE")).toHaveLength(2);
    expect((await herdrCliObservations(socket, journal))?.receipts).toHaveLength(3);

    const managedHome = join(root, "managed-home"), managedJournal = join(root, "managed-journal"), managedConfig = join(root, "managed.toml");
    const managedReal = join(root, "managed-real"), managedScript = join(root, "managed-real.ts"), heldReply = join(root, "managed-ready"), releaseReply = join(root, "managed-release");
    mkdirSync(managedHome);
    writeFileSync(managedConfig, '[terminal]\ndefault_shell = "/bin/bash"\nshell_mode = "non_login"\n');
    writeFileSync(managedScript, `
import { herdrRpc } from ${JSON.stringify(new URL("./herdr/client.ts", import.meta.url).href)};
const args = process.argv.slice(2), socket = process.env.HERDR_SOCKET_PATH!;
const child = Bun.spawn([${JSON.stringify(binary)}, ...args], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
if (code === 0 && args[0] === "agent" && args[1] === "prompt" && args[3] === "SHIM_MANAGED_INFLIGHT_PROBE") {
  await Bun.write(${JSON.stringify(heldReply)}, stdout);
  const deadline = Date.now() + 15000;
  while (!(await Bun.file(${JSON.stringify(releaseReply)}).exists())) {
    if (Date.now() > deadline) throw new Error("Owned managed prompt reply was not released");
    await herdrRpc("pane.get", { pane_id: ${JSON.stringify(targetPane)} }, socket);
  }
}
process.stdout.write(stdout); process.stderr.write(stderr); process.exit(code);
`);
    writeFileSync(managedReal, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(managedScript)} "$@"\n`, { mode: 0o700 });
    const managed = new CommunicationTracking({ home: managedHome, directory: managedJournal, configPath: managedConfig,
      env: { HOME: managedHome, SHELL: "/bin/bash", PATH: [bin, process.env["PATH"]].filter(Boolean).join(delimiter), OVIS_HERDR_BIN: managedReal } });
    const managedEnvironment = { PATH: [join(managedJournal, "installation"), bin, process.env["PATH"]].filter(Boolean).join(delimiter) };
    expect((await managed.enable()).state).toBe("enabled");
    expect(await herdrCliEndpoint(socket, sourcePane, managedJournal)).not.toBeNull();
    expect(await herdrCliEndpoint(socket, name, managedJournal)).not.toBeNull();
    expect(await invoke(["agent", "prompt", name, "SHIM_MANAGED_CAPTURE_PROBE"], sourcePane, managedEnvironment)).toMatchObject({ code: 0, stderr: "" });
    const managedPage = await herdrCliObservations(socket, managedJournal);
    expect(managedPage?.receipts).toHaveLength(1);
    expect(managedPage!.receipts[0]).toMatchObject({ kind: "communication", scope: "terminal", source_terminal: { terminal_id: source.root_pane.terminal_id }, target_terminal: { terminal_id: target.root_pane.terminal_id } });
    const held = invoke(["agent", "prompt", name, "SHIM_MANAGED_INFLIGHT_PROBE"], sourcePane, managedEnvironment);
    for (const deadline = Date.now() + 10000; !(await Bun.file(heldReply).exists());) {
      if (Date.now() > deadline) throw new Error("Owned managed prompt did not reach its held success reply");
      await herdrRpc("pane.read", { pane_id: targetPane, source: "recent", strip_ansi: true });
    }
    expect(JSON.parse(readFileSync(heldReply, "utf8")).result.agent.terminal_id).toBe(target.root_pane.terminal_id);
    expect((await managed.disable()).state).toBe("disabled");
    await Bun.write(releaseReply, "release");
    expect(await held).toMatchObject({ code: 0, stderr: "" });
    expect((await herdrCliObservations(socket, managedJournal))?.receipts.map((receipt) => receipt.id)).toEqual(managedPage!.receipts.map((receipt) => receipt.id));
    expect(await invoke(["agent", "prompt", name, "SHIM_MANAGED_DISABLED_PROBE"], sourcePane, managedEnvironment)).toMatchObject({ code: 0, stderr: "" });
    expect((await herdrCliObservations(socket, managedJournal))?.receipts.map((receipt) => receipt.id)).toEqual(managedPage!.receipts.map((receipt) => receipt.id));
    const managedMarkers = ["SHIM_MANAGED_CAPTURE_PROBE", "SHIM_MANAGED_INFLIGHT_PROBE", "SHIM_MANAGED_DISABLED_PROBE"];
    for (const deadline = Date.now() + 10000; !managedMarkers.every((marker) => readFileSync(log, "utf8").includes(marker));) {
      if (Date.now() > deadline) throw new Error("A managed prompt did not reach the owned recipient");
      await herdrRpc("pane.read", { pane_id: targetPane, source: "recent", strip_ansi: true });
    }
    const managedReceived = readFileSync(log, "utf8");
    for (const marker of managedMarkers) expect(managedReceived.split(marker)).toHaveLength(2);

    const previous = await herdrCliEndpoint(socket, name, journal);
    const processes = (await herdrRpc("pane.process_info", { pane_id: targetPane })).process_info?.foreground_processes ?? [];
    const ownProcess = processes.find((entry) => entry.argv?.includes(program));
    expect(ownProcess).toBeDefined();
    process.kill(ownProcess!.pid, "SIGTERM");
    for (const deadline = Date.now() + 10000; await herdrCliEndpoint(socket, name, journal);) {
      if (Date.now() > deadline) throw new Error("Owned stand-in did not exit");
    }
    await herdrRpc("pane.send_text", { pane_id: targetPane, text: `${[executable, program, log, "replacement"].map(quote).join(" ")}\n` });
    await ready(targetPane, "replacement"); await idle(targetPane);
    let replaced = await herdrCliEndpoint(socket, targetPane, journal);
    // Foreground discovery settles after a raw shell launch; retry the read, never the launch/input.
    for (const deadline = Date.now() + 10000; !replaced;) {
      if (Date.now() > deadline) throw new Error("Owned replacement did not acquire current process proof");
      replaced = await herdrCliEndpoint(socket, targetPane, journal);
    }
    expect(previous).not.toBeNull(); expect(replaced).not.toBeNull(); expect(graphHerdrEndpointKey(replaced!)).not.toBe(graphHerdrEndpointKey(previous!));
    const fresh = await machine(), updated = store.observe([fresh]), updatedRows = graphRegistryInventory(updated, [fresh]);
    expect(graphTarget(updated, updatedRows, targetNode.id, [fresh])).toBeNull();
    // Two fresh daemons guarantee equal pane IDs even when the main test daemon has
    // already served other contract files and advanced its workspace counter.
    const named: { socket: string; child: ReturnType<typeof Bun.spawn> }[] = [];
    const startNamed = async (session: string) => {
      const socket = join(config, "herdr", "sessions", session, "herdr.sock");
      const child = Bun.spawn([binary, "--session", session, "server"], {
        env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("HERDR_"))),
        cwd: root, stdin: "ignore", stdout: "ignore", stderr: "pipe",
      });
      children.push(child); named.push({ socket, child });
      const reader = child.stderr.getReader(), deadline = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 15000);
      try {
        let diagnostics = "";
        while (!diagnostics.includes(`api socket: ${socket}`)) {
          const part = await reader.read();
          if (part.done) throw new Error(`Owned named Herdr did not start: ${diagnostics}`);
          diagnostics += new TextDecoder().decode(part.value);
        }
      } finally { clearTimeout(deadline); reader.releaseLock(); }
      return socket;
    };
    try {
      const collisionSocket = await startNamed(`${process.env["HERDR_TEST_SESSION"]}-collision-source`);
      const remoteSession = `${process.env["HERDR_TEST_SESSION"]}-other`, remoteSocket = await startNamed(remoteSession);
      const caller = await herdrRpc<Awaited<ReturnType<typeof workspaceCreate>>>("workspace.create", { cwd: root, label: "ovis-test-shim-collision-source", env: environment }, collisionSocket);
      const destination = await herdrRpc<Awaited<ReturnType<typeof workspaceCreate>>>("workspace.create", { cwd: root, label: "ovis-test-shim-other-session", env: environment }, remoteSocket);
      const callerPane = caller.root_pane.pane_id, remotePane = destination.root_pane.pane_id;
      expect(remotePane).toBe(callerPane);
      await herdrRpc("pane.send_text", { pane_id: callerPane, text: `${[executable, program, log, "collision-source"].map(quote).join(" ")}\n` }, collisionSocket);
      await ready(callerPane, "collision-source", collisionSocket); await idle(callerPane, collisionSocket);
      const callerPage = await herdrCliObservations(collisionSocket, journal), remoteName = `${name}_other`;
      const sourceEnvironment = { HERDR_SOCKET_PATH: collisionSocket };
      const remoteStart = invoke(["--session", remoteSession, "agent", "start", remoteName, "--kind", "codex", "--pane", remotePane, "--", program, log, "other"], callerPane, sourceEnvironment);
      await ready(remotePane, "other", remoteSocket); await idle(remotePane, remoteSocket);
      expect((await remoteStart).code).toBe(0);
      expect((await invoke(["--session", remoteSession, "agent", "prompt", remoteName, "CROSS_SESSION_PROBE"], callerPane, sourceEnvironment)).code).toBe(0);
      const afterForward = await herdrCliObservations(collisionSocket, journal);
      const crossSession = afterForward!.receipts.filter((item) => item.source_terminal.server_id !== item.target_terminal.server_id);
      expect(crossSession.map((item) => item.kind).sort()).toEqual(["communication", "delegation"]);
      expect(crossSession.every((item) => item.source_terminal.pane_id === item.target_terminal.pane_id && item.source_terminal.server_id === callerPage!.server_id)).toBe(true);
      const remotePage = await herdrCliObservations(remoteSocket, journal);
      expect(remotePage?.server_id).not.toBe(callerPage!.server_id); expect(remotePage?.receipts).toHaveLength(0);
      expect(crossSession.every((item) => item.target_terminal.server_id === remotePage!.server_id)).toBe(true);
    } finally {
      for (const { socket, child } of named.reverse()) {
        await herdrRpc("server.stop", {}, socket).catch(() => { if (child.exitCode === null) child.kill(); });
        await child.exited;
      }
    }
    // Hold a real successful start reply until the same pane runs another process with the same name/kind.
    const race = await workspaceCreate({ cwd: root, label: "ovis-test-shim-start-race", env: environment }); owned.push(race.workspace.workspace_id);
    const racePane = race.root_pane.pane_id, raceName = `${name}_race`, raceScript = join(root, "race-real.ts"), raceBinary = join(root, "race-real"), raceState = join(root, "race-state.json"), raceReady = join(root, "race-ready.json"), raceContinue = join(root, "race-continue");
    writeFileSync(raceScript, `
import { herdrRpc } from ${JSON.stringify(new URL("./herdr/client.ts", import.meta.url).href)};
const socket = process.env.HERDR_SOCKET_PATH!;
const child = Bun.spawn([${JSON.stringify(binary)}, ...process.argv.slice(2)], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
if (code !== 0) { process.stdout.write(stdout); process.stderr.write(stderr); process.exit(code); }
const before = JSON.parse(stdout).result.agent;
await Bun.write(${JSON.stringify(raceReady)}, JSON.stringify(before));
while (!(await Bun.file(${JSON.stringify(raceContinue)}).exists())) await herdrRpc("pane.get", { pane_id: ${JSON.stringify(racePane)} }, socket);
const info = (await herdrRpc("pane.process_info", { pane_id: ${JSON.stringify(racePane)} }, socket)).process_info!;
const owned = info.foreground_processes!.find(entry => entry.argv?.includes(${JSON.stringify(program)}));
if (!owned) throw new Error("Owned race stand-in missing");
process.kill(owned.pid, "SIGTERM");
for (const deadline = Date.now() + 10000; (await herdrRpc("pane.process_info", { pane_id: ${JSON.stringify(racePane)} }, socket)).process_info?.foreground_processes?.some(entry => entry.pid === owned.pid);) {
  if (Date.now() > deadline) throw new Error("Owned race stand-in did not exit");
}
await herdrRpc("pane.send_text", { pane_id: ${JSON.stringify(racePane)}, text: ${JSON.stringify([executable, program, log, "race-replacement"].map(quote).join(" ") + "\n")} }, socket);
await herdrRpc("pane.wait_for_output", { pane_id: ${JSON.stringify(racePane)}, match: { type: "substring", value: "SHIM_READY_race-replacement" }, source: "recent", timeout_ms: 15000 }, socket, 20000);
await herdrRpc("pane.report_agent", { pane_id: ${JSON.stringify(racePane)}, source: "manual", agent: "codex", state: "idle" }, socket);
await herdrRpc("agent.rename", { target: ${JSON.stringify(racePane)}, name: ${JSON.stringify(raceName)} }, socket);
const after = (await herdrRpc("agent.get", { target: ${JSON.stringify(raceName)} }, socket)).agent;
await Bun.write(${JSON.stringify(raceState)}, JSON.stringify({ before, after }));
process.stdout.write(stdout); process.stderr.write(stderr);
`);
    writeFileSync(raceBinary, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(raceScript)} "$@"\n`, { mode: 0o700 });
    const raceWrapper = join(root, "race-shim");
    const installRace = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/herdr-shim.ts"), "install", "--real", raceBinary, "--directory", raceWrapper, "--journal", journal], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    expect(await installRace.exited).toBe(0);
    const racing = invoke(["agent", "start", raceName, "--kind", "codex", "--pane", racePane, "--", program, log, "race-first"], sourcePane, { PATH: [raceWrapper, bin, process.env["PATH"]].filter(Boolean).join(delimiter) });
    await ready(racePane, "race-first"); await idle(racePane);
    for (const deadline = Date.now() + 10000; !(await Bun.file(raceReady).exists());) {
      if (Date.now() > deadline) throw new Error("Owned start reply was not held");
      await herdrRpc("pane.read", { pane_id: racePane, source: "recent", strip_ansi: true });
    }
    const beforeRace = await machine(), beforeRaceRegistry = store.observe([beforeRace]), beforeRaceRows = graphRegistryInventory(beforeRaceRegistry, [beforeRace]);
    const oldRaceNode = graphInventory(beforeRaceRegistry, beforeRaceRows, [beforeRace]).nodes.find((node) => node.kind === "terminal" && graphTarget(beforeRaceRegistry, beforeRaceRows, node.id, [beforeRace])?.pane_id === racePane)!;
    expect(oldRaceNode).toBeDefined();
    await Bun.write(raceContinue, "continue");
    const raceResult = await racing;
    expect({ code: raceResult.code, stderr: raceResult.stderr }).toEqual({ code: 0, stderr: "" });
    const raced = JSON.parse(readFileSync(raceState, "utf8"));
    expect(raced.after).toMatchObject({ terminal_id: raced.before.terminal_id, agent: raced.before.agent, name: raced.before.name });
    console.log(`Stock start replacement: same terminal/kind/name; state sequence ${raced.before.state_change_seq} → ${raced.after.state_change_seq}`);
    const racePage = await herdrCliObservations(socket, journal);
    const raceReceipt = racePage?.receipts.find((receipt) => receipt.target_terminal.terminal_id === race.root_pane.terminal_id);
    expect(raceReceipt).toBeDefined(); expect(raceReceipt?.scope).toBe("terminal");
    expect(JSON.stringify(raceReceipt)).not.toContain("agent_instance_id");
    const afterRace = await machine(), afterRaceRegistry = store.observe([afterRace]), afterRaceRows = graphRegistryInventory(afterRaceRegistry, [afterRace]);
    expect(graphTarget(afterRaceRegistry, afterRaceRows, oldRaceNode.id, [afterRace])).toBeNull();
    const afterRaceGraph = graphInventory(afterRaceRegistry, afterRaceRows, [afterRace]);
    const currentRaceNode = afterRaceGraph.nodes.find((node) => node.kind === "terminal" && graphTarget(afterRaceRegistry, afterRaceRows, node.id, [afterRace])?.pane_id === racePane)!;
    expect(afterRaceGraph.edges.some((edge) => edge.kind === "delegation" && edge.target === currentRaceNode.id && edge.sources?.includes("herdr-cli"))).toBe(true);
    // Journal failure stays outside the execution path.
    const wrong = join(root, "not-a-directory"); writeFileSync(wrong, "preserve");
    const noJournalWrapper = join(root, "fail-open-shim");
    const installFailure = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/herdr-shim.ts"), "install", "--real", binary, "--directory", noJournalWrapper, "--journal", wrong], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    expect(await installFailure.exited).toBe(0);
    const failOpen = await invoke(["agent", "prompt", targetPane, "SHIM_JOURNAL_FAILURE_PROBE"], sourcePane, { PATH: [noJournalWrapper, bin, process.env["PATH"]].filter(Boolean).join(delimiter) });
    expect(failOpen.code).toBe(0); expect(readFileSync(log, "utf8").split("SHIM_JOURNAL_FAILURE_PROBE")).toHaveLength(2); expect(readFileSync(wrong, "utf8")).toBe("preserve");
  } finally {
    if (beforeJournal === undefined) delete process.env["OVIS_HERDR_CLI_DIR"]; else process.env["OVIS_HERDR_CLI_DIR"] = beforeJournal;
    for (const child of children) if (child.exitCode === null) child.kill();
    for (const workspace of owned.reverse()) await workspaceClose(workspace).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}, 90000);
