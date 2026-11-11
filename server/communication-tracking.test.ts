import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommunicationTracking } from "./communication-tracking.ts";

function fixture(shell = "/bin/bash", config = "") {
  const root = mkdtempSync(join(tmpdir(), "ovis-tracking-"));
  const home = join(root, "home"), bin = join(root, "bin"), journal = join(root, "journal");
  mkdirSync(home); mkdirSync(bin);
  const real = join(bin, "herdr"), configPath = join(root, "config.toml");
  writeFileSync(real, "#!/bin/sh\nprintf 'real:%s\\n' \"$*\"\n"); chmodSync(real, 0o700);
  writeFileSync(configPath, `[terminal]\ndefault_shell = ${JSON.stringify(shell)}\n${config}`);
  const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, SHELL: shell, OVIS_HERDR_BIN: real };
  const service = new CommunicationTracking({ home, env, configPath, directory: journal });
  return { root, home, bin, journal, real, configPath, env, service };
}

describe.skipIf(process.platform === "win32")("communication tracking setup", () => {
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
      expect((await new CommunicationTracking({ home: f.home, env: f.env, configPath: f.configPath, directory: f.journal }).status()).state).toBe("enabled");
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
      writeFileSync(join(installation, "observe.js"), "throw new Error('damaged bundle');\n");
      expect((await f.service.status()).state).toBe("needs_attention");
      expect((await f.service.enable()).state).toBe("enabled");
      writeFileSync(join(installation, "config.json"), "{interrupted");
      expect((await f.service.disable()).state).toBe("disabled");
      const wrapper = Bun.spawnSync([join(installation, "herdr"), "agent", "prompt", "worker", "message"], { env: { ...f.env, HERDR_ENV: "1", HERDR_PANE_ID: "not-live" } });
      expect(wrapper.exitCode).toBe(0); expect(wrapper.stdout.toString()).toBe("real:agent prompt worker message\n");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
