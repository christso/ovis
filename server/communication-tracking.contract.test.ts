import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CommunicationTracking } from "./communication-tracking.ts";
import { herdrRpc, paneSendText, workspaceCreate } from "./herdr/client.ts";

/** A real stock daemon and its shell environment, never the user's home or session. */
it.skipIf(process.platform !== "linux")("enables tracking for new stock Herdr panes without changing or restarting existing panes", async () => {
  const binary = process.env["OVIS_HERDR_BIN"] || Bun.which("herdr");
  if (!binary || !process.env["HERDR_TEST_SESSION"]?.startsWith("check-")) throw new Error("Run with bun run check run in its disposable Herdr session");
  const root = mkdtempSync(join(tmpdir(), "ot-")), home = join(root, "home"), config = join(root, "cfg"), configFile = join(root, "herdr.toml");
  mkdirSync(home); mkdirSync(config);
  writeFileSync(join(home, ".bashrc"), "export UNRELATED_TRACKING_SETTING=kept\n");
  writeFileSync(configFile, '[terminal]\ndefault_shell = "/bin/bash"\nshell_mode = "non_login"\n');
  const socket = join(config, "herdr/sessions/setup/herdr.sock"), previousSocket = process.env["HERDR_SOCKET"];
  const child = Bun.spawn([binary, "--session", "setup", "server"], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "SHELL" && !/^(HERDR|OMO|SENPI|PI)_/.test(key))), HOME: home, XDG_CONFIG_HOME: config, HERDR_CONFIG_PATH: configFile,
      PATH: [dirname(binary), "/usr/local/bin", "/usr/bin", "/bin"].join(":"), BASH_ENV: undefined, ENV: undefined },
    cwd: root, stdin: "ignore", stdout: "ignore", stderr: "pipe",
  });
  const deadline = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 15_000);
  const reader = child.stderr.getReader();
  try {
    let diagnostics = "";
    while (!diagnostics.includes(`api socket: ${socket}`)) {
      const part = await reader.read();
      if (part.done) throw new Error("The isolated setup daemon did not start");
      diagnostics += new TextDecoder().decode(part.value);
      if (diagnostics.length > 65536) throw new Error("The isolated setup daemon printed too much");
    }
    clearTimeout(deadline); reader.releaseLock();
    process.env["HERDR_SOCKET"] = socket;
    const original = await workspaceCreate({ cwd: home, label: "setup-original" });
    const service = new CommunicationTracking({ home, directory: join(root, "journal") });
    const before = await service.status();
    expect(before).toMatchObject({ state: "disabled", shell: "/bin/bash", profiles: [join(home, ".bashrc"), join(home, ".bash_profile")] });
    expect((await service.enable({ shell: before.shell, profiles: before.profiles })).state).toBe("enabled");
    const lookup = async (pane: string, path: string) => {
      await paneSendText(pane, "command -v herdr\n");
      await herdrRpc("pane.wait_for_output", { pane_id: pane, match: { type: "substring", value: path }, source: "recent", timeout_ms: 10000 });
    };
    await lookup(original.root_pane.pane_id, binary);
    const activated = await workspaceCreate({ cwd: home, label: "setup-enabled" });
    await lookup(activated.root_pane.pane_id, join(root, "journal/installation/herdr"));
    expect(child.exitCode).toBeNull();
    expect((await service.disable()).state).toBe("disabled");
    const version = Bun.spawnSync([binary, "--version"], { stdin: "ignore" }).stdout.toString().trim();
    expect(version.length).toBeGreaterThan(0);
    await paneSendText(activated.root_pane.pane_id, "herdr --version\n");
    await herdrRpc("pane.wait_for_output", { pane_id: activated.root_pane.pane_id, match: { type: "substring", value: version }, source: "recent", timeout_ms: 10000 });
    const disabled = await workspaceCreate({ cwd: home, label: "setup-disabled" });
    await lookup(disabled.root_pane.pane_id, binary);
    expect(readFileSync(join(home, ".bashrc"), "utf8")).toBe("export UNRELATED_TRACKING_SETTING=kept\n");
    expect(child.exitCode).toBeNull();
  } finally {
    clearTimeout(deadline);
    try { reader.releaseLock(); } catch {}
    await herdrRpc("server.stop", {}, socket).catch(() => { if (child.exitCode === null) child.kill(); });
    await child.exited;
    if (previousSocket === undefined) delete process.env["HERDR_SOCKET"]; else process.env["HERDR_SOCKET"] = previousSocket;
    rmSync(root, { recursive: true, force: true });
  }
});
