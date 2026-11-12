import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommunicationTracking } from "./communication-tracking.ts";
import { shellQuote } from "./machine-security.ts";

function fixture(shell = "/bin/bash", config = "") {
  const root = mkdtempSync(join(tmpdir(), "ovis-tracking-"));
  const home = join(root, "home"), bin = join(root, "bin"), journal = join(root, "journal");
  mkdirSync(home); mkdirSync(bin);
  const real = join(bin, "herdr"), configPath = join(root, "config.toml");
  writeFileSync(real, "#!/bin/sh\nprintf 'real:%s\\n' \"$*\"\n"); chmodSync(real, 0o700);
  writeFileSync(configPath, `[terminal]\ndefault_shell = ${JSON.stringify(shell)}\n${config}`);
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, SHELL: shell, OVIS_HERDR_BIN: real };
  const service = new CommunicationTracking({ home, env, configPath, directory: journal, stateDir: join(root, "ovis-state") });
  return { root, home, bin, journal, real, configPath, env, service };
}

describe.skipIf(process.platform === "win32")("communication tracking setup", () => {
  it("uses newly confirmed startup paths after disabling the previous setup", async () => {
    const f = fixture();
    try {
      expect((await f.service.enable()).state).toBe("enabled");
      expect((await f.service.disable()).state).toBe("disabled");
      writeFileSync(join(f.home, ".profile"), "export ADDED_AFTER_DISABLE=kept\n");
      const next = await f.service.status();
      expect(next.profiles).toEqual([join(f.home, ".bashrc"), join(f.home, ".profile")]);
      expect((await f.service.enable({ shell: next.shell, profiles: next.profiles })).state).toBe("enabled");
      expect((await f.service.disable()).state).toBe("disabled");
      expect(readFileSync(join(f.home, ".profile"), "utf8")).toBe("export ADDED_AFTER_DISABLE=kept\n");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("retains the inherited command and stops collection when replacement cannot be built", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, ".bashrc"), "export PRESERVED_ON_FAILED_REPAIR=kept\n");
      expect((await f.service.enable()).state).toBe("enabled");
      const wrapper = join(f.journal, "installation", "herdr");
      renameSync(f.real, f.real + ".away");
      await f.service.disable();
      expect(existsSync(wrapper)).toBe(true);
      expect(JSON.parse(readFileSync(join(f.journal, "installation", "config.json"), "utf8")).enabled).toBe(false);
      expect(readFileSync(join(f.home, ".bashrc"), "utf8")).toBe("export PRESERVED_ON_FAILED_REPAIR=kept\n");
      renameSync(f.real + ".away", f.real);
      const inherited = Bun.spawnSync([wrapper, "--version"], { env: f.env });
      expect(inherited.exitCode).toBe(0);
      expect(inherited.stdout.toString()).toBe("real:--version\n");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("finds the original command in the initialized shell PATH", async () => {
    const f = fixture(), previous = process.env["OVIS_HERDR_BIN"];
    try {
      delete process.env["OVIS_HERDR_BIN"];
      writeFileSync(join(f.home, ".bashrc"), `export PATH=${shellQuote(f.bin)}:"$PATH"\n`);
      const env = { HOME: f.home, PATH: "/usr/bin:/bin", SHELL: "/bin/bash" };
      const service = new CommunicationTracking({ home: f.home, env, configPath: f.configPath, directory: f.journal });
      expect((await service.enable()).state).toBe("enabled");
      expect(JSON.parse(readFileSync(join(f.journal, "installation", "config.json"), "utf8")).real).toBe(f.real);
      expect((await service.disable()).state).toBe("disabled");
    } finally {
      if (previous === undefined) delete process.env["OVIS_HERDR_BIN"]; else process.env["OVIS_HERDR_BIN"] = previous;
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it.skipIf(!Bun.which("setsid"))("bounds a startup probe whose detached child retains its pipes", async () => {
    const f = fixture(), pidFile = join(f.root, "detached.pid");
    let pending: Promise<unknown> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      writeFileSync(join(f.home, ".bashrc"), `setsid -f /bin/sh -c ${shellQuote(`printf '%s\\n' "$$" > ${shellQuote(pidFile)}; exec /bin/sleep 20`)}\n`);
      pending = f.service.enable();
      const answer = await Promise.race([pending, new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("setup exceeded its probe deadline")), 8000); })]);
      expect(answer).toMatchObject({ state: "needs_attention" });
    } finally {
      clearTimeout(deadline);
      try { process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGKILL"); } catch {}
      await pending?.catch(() => {});
      rmSync(f.root, { recursive: true, force: true });
    }
  }, 15000);

  it("refuses an unreadable Herdr configuration instead of guessing another shell", async () => {
    const f = fixture();
    try {
      writeFileSync(f.configPath, "[terminal\ninvalid TOML");
      expect((await f.service.status()).state).toBe("unsupported");
      expect((await f.service.enable()).state).toBe("unsupported");
      expect(existsSync(f.journal)).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  it("installs and verifies a new Herdr shell, stays out of ordinary shells, and disables without breaking an inherited PATH", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, ".bashrc"), "export USER_SETTING=kept\n");
      expect((await f.service.status()).state).toBe("disabled");
      expect(existsSync(f.journal)).toBe(false);
      const enabled = await f.service.enable();
      expect(enabled.state).toBe("enabled");
      expect(enabled.profiles).toEqual([join(f.home, ".bashrc"), join(f.home, ".bash_profile")]);
      const wrapper = join(f.journal, "installation", "herdr");
      const lookup = (herdr: boolean) => Bun.spawnSync(["/bin/bash", "-i", "-c", "command -v herdr"], { env: { ...f.env, ...(herdr ? { HERDR_ENV: "1" } : {}) }, stderr: "ignore" }).stdout.toString().trim();
      expect(lookup(true)).toBe(wrapper);
      expect(lookup(false)).toBe(f.real);
      expect((await f.service.enable()).state).toBe("enabled");
      writeFileSync(join(f.home, ".bashrc"), readFileSync(join(f.home, ".bashrc"), "utf8") + "export ADDED_LATER=kept\n");
      expect((await new CommunicationTracking({ home: f.home, env: f.env, configPath: f.configPath, directory: f.journal, stateDir: join(f.root, "ovis-state") }).status()).state).toBe("enabled");
      expect((await f.service.disable()).state).toBe("disabled");
      expect(existsSync(join(f.home, ".bash_profile"))).toBe(false);
      expect(readFileSync(join(f.home, ".bashrc"), "utf8")).toBe("export USER_SETTING=kept\nexport ADDED_LATER=kept\n");
      expect(lookup(true)).toBe(f.real);
      const old = Bun.spawnSync([wrapper, "agent", "prompt", "worker", "message"], { env: { ...f.env, HERDR_ENV: "1", HERDR_PANE_ID: "not-live" } });
      expect(old.exitCode).toBe(0); expect(old.stdout.toString()).toBe("real:agent prompt worker message\n");
      expect(readFileSync(f.real, "utf8")).toContain("real:%s");
      expect((await f.service.disable()).state).toBe("disabled");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("uses an existing Bash login profile and preserves symlink targets", async () => {
    const f = fixture("/bin/bash", 'shell_mode = "login"\n');
    try {
      const target = join(f.root, "shared-profile"); writeFileSync(target, "export BEFORE=kept\n");
      symlinkSync(target, join(f.home, ".profile"));
      expect((await f.service.status()).profiles).toEqual([join(f.home, ".bashrc"), join(f.home, ".profile")]);
      expect((await f.service.enable()).state).toBe("enabled");
      expect(existsSync(join(f.home, ".bash_profile"))).toBe(false);
      expect(readFileSync(target, "utf8")).toContain("Ovis communication tracking");
      await f.service.disable(); expect(readFileSync(target, "utf8")).toBe("export BEFORE=kept\n");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("reports failed command lookup and preserves an edited block while disabling collection", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, ".bashrc"), "herdr() { echo custom; }\n");
      expect((await f.service.enable()).state).toBe("needs_attention");
      const profile = join(f.home, ".bashrc");
      writeFileSync(profile, readFileSync(profile, "utf8").replace("# Ovis communication tracking", "# Ovis communication tracking edited"));
      const disabled = await f.service.disable();
      expect(disabled.state).toBe("needs_attention");
      expect(readFileSync(profile, "utf8")).toContain("edited");
      expect(JSON.parse(readFileSync(join(f.journal, "installation", "config.json"), "utf8")).enabled).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("refuses unsupported shells and unowned installation directories without changing profiles", async () => {
    const unsupported = fixture("/bin/sh");
    try { expect((await unsupported.service.enable()).state).toBe("unsupported"); expect(existsSync(unsupported.journal)).toBe(false); }
    finally { rmSync(unsupported.root, { recursive: true, force: true }); }
    const f = fixture();
    try {
      mkdirSync(join(f.journal, "installation"), { recursive: true }); writeFileSync(join(f.journal, "installation", "user-file"), "keep");
      expect((await f.service.enable()).state).toBe("needs_attention");
      expect(existsSync(join(f.home, ".bashrc"))).toBe(false);
      expect(readFileSync(join(f.journal, "installation", "user-file"), "utf8")).toBe("keep");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("requires the confirmed shell and profiles to match before creating installation state", async () => {
    const f = fixture();
    try {
      await expect(f.service.enable({ shell: "/bin/zsh", profiles: [join(f.home, ".zshrc")] })).rejects.toMatchObject({ code: "setup_changed" });
      expect(existsSync(f.journal)).toBe(false);
      expect(existsSync(join(f.home, ".bashrc"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.skipIf(!Bun.which("zsh"))("uses ZDOTDIR set by .zshenv and reports a broken wrapper instead of enabled", async () => {
    const f = fixture(Bun.which("zsh")!);
    try {
      const custom = join(f.home, "custom shell directory"); mkdirSync(custom);
      writeFileSync(join(f.home, ".zshenv"), `export ZDOTDIR=${JSON.stringify(custom)}\n`);
      expect((await f.service.status()).profiles).toEqual([join(custom, ".zshrc")]);
      expect((await f.service.enable()).state).toBe("enabled");
      expect(existsSync(join(f.home, ".zshrc"))).toBe(false);
      rmSync(join(f.journal, "installation", "observe.js"));
      expect((await f.service.status()).state).toBe("needs_attention");
      expect((await f.service.disable()).state).toBe("disabled");
      expect(existsSync(join(custom, ".zshrc"))).toBe(false);
      writeFileSync(f.configPath, '[terminal]\ndefault_shell = "/bin/bash"\n');
      const changed = await f.service.status();
      expect(changed.shell).toBe("/bin/bash");
      expect((await f.service.enable({ shell: changed.shell, profiles: changed.profiles })).state).toBe("enabled");
      expect((await f.service.disable()).state).toBe("disabled");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it.skipIf(!Bun.which("fish"))("configures Fish's XDG config after user PATH setup", async () => {
    const f = fixture(Bun.which("fish")!);
    try {
      const xdg = join(f.home, "custom-config");
      const env = { ...f.env, XDG_CONFIG_HOME: xdg };
      const service = new CommunicationTracking({ home: f.home, env, configPath: f.configPath, directory: f.journal });
      expect((await service.status()).profiles).toEqual([join(xdg, "fish", "config.fish")]);
      expect((await service.enable()).state).toBe("enabled");
      expect((await service.disable()).state).toBe("disabled");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("serializes competing requests and keeps the confirmed setup intact", async () => {
    const f = fixture();
    try {
      const other = new CommunicationTracking({ home: f.home, env: f.env, configPath: f.configPath, directory: f.journal });
      const status = await f.service.status(), expected = { shell: status.shell, profiles: status.profiles };
      expect((await Promise.all([f.service.enable(expected), other.enable(expected)])).map((answer) => answer.state)).toEqual(["enabled", "enabled"]);
      expect(readFileSync(join(f.home, ".bashrc"), "utf8").split("# Ovis communication tracking").length).toBe(2);
      await other.disable(); expect((await f.service.status()).state).toBe("disabled");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("recovers an owned interrupted installation on retry and repairs it to passthrough on disable", async () => {
    const f = fixture();
    try {
      expect((await f.service.enable()).state).toBe("enabled");
      const installation = join(f.journal, "installation");
      const record = JSON.parse(readFileSync(join(f.journal, "setup.json"), "utf8"));
      record.enabled = false; writeFileSync(join(f.journal, "setup.json"), JSON.stringify(record));
      for (const name of ["observe.js", "config.json", "herdr", "enabled"]) rmSync(join(installation, name), { force: true });
      expect((await f.service.enable()).state).toBe("enabled");
      writeFileSync(join(installation, "unrelated-note"), "keep during repair\n");
      writeFileSync(join(installation, "observe.js"), "throw new Error('damaged bundle');\n");
      expect((await f.service.status()).state).toBe("needs_attention");
      expect((await f.service.enable()).state).toBe("enabled");
      expect(readFileSync(join(installation, "unrelated-note"), "utf8")).toBe("keep during repair\n");
      writeFileSync(join(installation, "config.json"), "{interrupted");
      expect((await f.service.disable()).state).toBe("disabled");
      const wrapper = Bun.spawnSync([join(installation, "herdr"), "agent", "prompt", "worker", "message"], { env: { ...f.env, HERDR_ENV: "1", HERDR_PANE_ID: "not-live" } });
      expect(wrapper.exitCode).toBe(0); expect(wrapper.stdout.toString()).toBe("real:agent prompt worker message\n");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

it.skipIf(process.platform !== "linux")("refreshes an owned older wrapper only through explicit setup", async () => {
  const f = fixture();
  try {
    expect((await f.service.enable()).state).toBe("enabled");
    const configPath = join(f.journal, "installation", "config.json"), bundle = join(f.journal, "installation", "observe.js");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    delete config.bundle_revision;
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(bundle, "// preserved old bundle until explicit setup\n" + readFileSync(bundle, "utf8"));
    const old = readFileSync(bundle, "utf8");
    expect((await f.service.status()).state).toBe("needs_attention");
    expect(readFileSync(bundle, "utf8")).toBe(old);
    expect((await f.service.enable()).state).toBe("enabled");
    expect(readFileSync(bundle, "utf8")).not.toContain("preserved old bundle");
    expect(JSON.parse(readFileSync(configPath, "utf8")).bundle_revision).toBe(3);
    expect(JSON.parse(readFileSync(configPath, "utf8")).display_state).toBe(join(f.root, "ovis-state"));
    expect((await f.service.disable()).state).toBe("disabled");
    expect(JSON.parse(readFileSync(configPath, "utf8")).display_state).toBe(join(f.root, "ovis-state"));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
