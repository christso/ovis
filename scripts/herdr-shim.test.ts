import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herdrCliOperation, herdrCliSubmitted } from "../server/herdr/cli-observations.ts";

it("keeps namespace selection separate from operands and does not capture remote machine calls", () => {
  expect(herdrCliOperation(["--session", "check-two", "agent", "prompt", "worker", "hello", "--wait"])).toEqual({ kind: "communication", target: "worker", session: "check-two" });
  expect(herdrCliOperation(["agent", "start", "worker", "--kind", "codex", "--pane", "w2:p1", "--", "--session", "native-argument"])).toEqual({ kind: "delegation", target: "worker", session: null });
  expect(herdrCliOperation(["--session=check-two", "agent", "prompt", "worker", "hello"])).toEqual({ kind: "communication", target: "worker", session: "check-two" });
  expect(herdrCliOperation(["--machine", "remote", "agent", "prompt", "worker", "hello"])).toBeNull();
  expect(herdrCliOperation(["--remote=host", "agent", "prompt", "worker", "hello"])).toBeNull();
  expect(herdrCliOperation(["agent", "list"])).toBeNull();
});

it("distinguishes successful submission from the wait's later failure", () => {
  expect(herdrCliSubmitted("communication", 0, { result: { agent: { terminal_id: "owned-terminal" } } })).toBe(true);
  expect(herdrCliSubmitted("communication", 1, { error: { code: "timeout", message: "timed out waiting for agent status" } })).toBe(true);
  expect(herdrCliSubmitted("communication", 1, { error: { code: "agent_prompt_stalled", message: "agent prompt produced no observed working or blocked state within 5000 ms; current status is idle" } })).toBe(true);
  expect(herdrCliSubmitted("communication", 1, { error: { code: "timeout", message: "submission timed out" } })).toBe(false);
  expect(herdrCliSubmitted("communication", 1, { error: { code: "agent_not_found", message: "no such worker" } })).toBe(false);
  expect(herdrCliSubmitted("delegation", 1, { error: { code: "timeout", message: "timed out waiting for agent status" } })).toBe(false);
});

it.skipIf(process.platform === "win32")("installs into a separate directory and transparently forwards arguments, streams and failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-herdr-cli-"));
  try {
    const real = join(root, "real-herdr"), installed = join(root, "shim"), bytes = join(root, "arguments.json");
    writeFileSync(real, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${join(root, "real.ts").replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
    writeFileSync(join(root, "real.ts"), 'await Bun.write(process.env.ARGV_FILE!, JSON.stringify(process.argv.slice(2))); if(process.argv[2]==="stdin"){for await(const part of process.stdin)process.stdout.write(part);process.exit(0)}if(process.argv[2]==="signal"){process.stdout.write("READY\\n");setInterval(()=>{},1000);await new Promise(()=>{})}process.stdout.write("ordinary output\\n"); process.stderr.write("ordinary error\\n"); process.exit(7);\n');
    const install = Bun.spawn([process.execPath, join(import.meta.dir, "herdr-shim.ts"), "install", "--real", real, "--directory", installed], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect({ code: await install.exited, stderr: await new Response(install.stderr).text() }).toEqual({ code: 0, stderr: "" });
    const shim = join(installed, "herdr"), args = ["pane", "read", "quotes ' \" $HOME `no execution`\nsecond line Ω"];
    const command = Bun.spawn([shim, ...args], { env: { ...process.env, ARGV_FILE: bytes }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const code = await command.exited, stdout = await new Response(command.stdout).text(), stderr = await new Response(command.stderr).text();
    expect({ code, stderr }).toEqual({ code: 7, stderr: "ordinary error\n" });
    expect(stdout).toBe("ordinary output\n");
    expect(stderr).toBe("ordinary error\n");
    expect(JSON.parse(readFileSync(bytes, "utf8"))).toEqual(args);
    expect(readFileSync(real, "utf8")).toContain("real.ts");
    const missingSocket = join(root, "absent-metadata.sock");
    const failedProbe = Bun.spawn([shim, "agent", "prompt", "worker", "private text"], { env: { ...process.env, ARGV_FILE: bytes,
      HERDR_ENV: "1", HERDR_PANE_ID: "owned:p1", HERDR_SOCKET_PATH: missingSocket, HERDR_SOCKET: missingSocket }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    expect(await failedProbe.exited).toBe(7);
    expect(await new Response(failedProbe.stdout).text()).toBe("ordinary output\n");
    expect(await new Response(failedProbe.stderr).text()).toBe("ordinary error\n");
    const input = Bun.spawn([shim, "stdin"], { env: { ...process.env, ARGV_FILE: bytes, HERDR_ENV: "0" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    input.stdin.write("stdin bytes \"quoted\"\nΩ\n"); input.stdin.end();
    expect(await new Response(input.stdout).text()).toBe("stdin bytes \"quoted\"\nΩ\n");
    expect(await input.exited).toBe(0);
    const waiting = Bun.spawn([shim, "signal"], { env: { ...process.env, ARGV_FILE: bytes, HERDR_ENV: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const reader = waiting.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("READY\n");
    waiting.kill("SIGTERM"); await waiting.exited; reader.releaseLock();
    expect(waiting.signalCode).toBe("SIGTERM");
    const again = Bun.spawn([process.execPath, join(import.meta.dir, "herdr-shim.ts"), "install", "--real", real, "--directory", installed], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    expect(await again.exited).not.toBe(0);
    expect(readFileSync(real, "utf8")).toContain("real.ts");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32" || !Bun.which("python3"))("forwards a PTY Ctrl-C once, preserves terminal stdin and forwards direct SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-shim-signals-"));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  try {
    const real = join(root, "real-herdr"), installed = join(root, "shim"), counts = join(root, "signals.json");
    writeFileSync(real, `#!/usr/bin/env python3
import json, os, signal, sys
counts = {"int": 0, "term": 0}
with open(${JSON.stringify(join(root, "child.pid"))}, "w") as output: output.write(str(os.getpid()))
def interrupt(signum, frame):
    counts["int"] += 1
    os.write(1, ("INT:" + str(counts["int"]) + "\\n").encode())
def terminate(signum, frame):
    counts["term"] += 1
    with open(${JSON.stringify(counts)}, "w") as output: json.dump(counts, output)
    sys.exit(23)
signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGTERM, terminate)
print("READY:TTY=" + str(sys.stdin.isatty()), flush=True)
for line in sys.stdin: print("INPUT:" + line.strip(), flush=True)
`, { mode: 0o700 });
    const install = Bun.spawn([process.execPath, join(import.meta.dir, "herdr-shim.ts"), "install", "--real", real, "--directory", installed], { stdout: "ignore", stderr: "pipe" }); children.push(install);
    expect({ code: await install.exited, stderr: await new Response(install.stderr).text() }).toEqual({ code: 0, stderr: "" });
    // The runner owns a fresh controlling terminal and foreground group, never the user's TTY.
    const runner = Bun.spawn(["python3", "-c", `
import fcntl, json, os, pty, select, signal, sys, termios, time
master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    for fd in (0, 1, 2): os.dup2(slave, fd)
    if slave > 2: os.close(slave)
    os.execv(sys.argv[1], [sys.argv[1], "agent", "prompt", "worker", "test"])
os.close(slave)
output = b""
def until(marker):
    global output
    deadline = time.monotonic() + 8
    while marker not in output:
        remaining = deadline - time.monotonic()
        if remaining <= 0: raise RuntimeError(repr(output))
        readable, _, _ = select.select([master], [], [], remaining)
        if readable:
            try: output += os.read(master, 65536)
            except OSError as error: raise RuntimeError("TTY closed while waiting for " + repr(marker) + ": " + repr(output)) from error
try:
    until(b"READY:TTY=True")
    os.write(master, b"BEFORE\\n")
    until(b"INPUT:BEFORE")
    os.write(master, b"\\x03")
    until(b"INT:1")
    os.write(master, b"AFTER\\n")
    until(b"INPUT:AFTER")
    os.kill(pid, signal.SIGTERM)
    _, status = os.waitpid(pid, 0)
    print(json.dumps({"code": os.waitstatus_to_exitcode(status), "output": output.decode()}))
finally:
    try: os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    os.close(master)
    try:
        with open(${JSON.stringify(join(root, "child.pid"))}) as child_file: os.kill(int(child_file.read()), signal.SIGKILL)
    except (FileNotFoundError, ProcessLookupError): pass
`, join(installed, "herdr")], { env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "owned:p1", HERDR_SOCKET_PATH: join(root, "missing.sock") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" }); children.push(runner);
    const [stdout, stderr, code] = await Promise.all([new Response(runner.stdout).text(), new Response(runner.stderr).text(), runner.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout).code).toBe(23);
    expect(JSON.parse(readFileSync(counts, "utf8"))).toEqual({ int: 1, term: 1 });
  } finally { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); }
}, 20000);

for (const stream of ["stdout", "stderr"] as const) it.skipIf(process.platform === "win32")(`reaps the observed child when the ${stream} consumer closes early`, async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-shim-pipe-"));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  try {
    const real = join(root, "real-herdr"), installed = join(root, "shim"), pidFile = join(root, "pid");
    writeFileSync(real, `#!/bin/sh\necho $$ > '${pidFile}'\n${stream === "stderr" ? "exec 1>&2\n" : ""}while :; do printf 'stream output\\n'; done\n`, { mode: 0o700 });
    const install = Bun.spawn([process.execPath, join(import.meta.dir, "herdr-shim.ts"), "install", "--real", real, "--directory", installed], { stdout: "ignore", stderr: "pipe" }); children.push(install);
    expect(await install.exited).toBe(0);
    const child = Bun.spawn([join(installed, "herdr"), "agent", "prompt", "worker", "test"], { env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "owned:p1", HERDR_SOCKET_PATH: join(root, "missing.sock") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" }); children.push(child);
    const pipe = child[stream].getReader();
    expect((await pipe.read()).value?.length).toBeGreaterThan(0);
    await pipe.cancel(); pipe.releaseLock();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { expect(await Promise.race([child.exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Shim did not finish after its consumer closed")), 3000); })])).toBe(141); }
    finally { clearTimeout(timer); }
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    try { process.kill(Number(readFileSync(join(root, "pid"), "utf8").trim()), "SIGKILL"); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);

it.skipIf(process.platform === "win32" || !Bun.which("python3"))("forwards foreground-group SIGQUIT and reaps the command before exiting with its signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "ovis-shim-quit-"));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  try {
    const real = join(root, "real-herdr"), installed = join(root, "shim");
    writeFileSync(real, `#!/usr/bin/env python3
import os, signal
signal.signal(signal.SIGQUIT, signal.SIG_DFL)
with open(os.environ["MOCK_PID_FILE"], "w") as output: output.write(str(os.getpid()))
print("READY", flush=True)
while True: signal.pause()
`, { mode: 0o700 });
    const install = Bun.spawn([process.execPath, join(import.meta.dir, "herdr-shim.ts"), "install", "--real", real, "--directory", installed], { stdout: "ignore", stderr: "pipe" }); children.push(install);
    expect({ code: await install.exited, stderr: await new Response(install.stderr).text() }).toEqual({ code: 0, stderr: "" });
    // Each invocation owns a foreground process group. Group SIGQUIT models terminal Ctrl-\.
    const runner = Bun.spawn(["python3", "-c", `
import json, os, resource, select, signal, subprocess, sys
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
results = []
for label, executable in [("direct", sys.argv[1]), ("shim", sys.argv[2])]:
    pidfile = os.path.join(sys.argv[3], label + ".pid")
    command = subprocess.Popen([executable, "agent", "prompt", "worker", "test"], env={**os.environ, "MOCK_PID_FILE": pidfile}, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    child = None
    try:
        if not select.select([command.stdout], [], [], 5)[0]: raise RuntimeError("Command did not become ready")
        assert command.stdout.readline() == b"READY\\n"
        with open(pidfile) as source: child = int(source.read())
        os.killpg(command.pid, signal.SIGQUIT)
        try: code = command.wait(timeout=3)
        except subprocess.TimeoutExpired as error:
            def state(pid):
                try:
                    keys = ("State:", "PPid:", "NSpgid:", "NSsid:", "CoreDumping:", "SigPnd:", "ShdPnd:", "SigBlk:", "SigIgn:", "SigCgt:")
                    with open("/proc/" + str(pid) + "/status") as status: return [line.strip() for line in status if line.startswith(keys)]
                except OSError: return "unavailable"
            try:
                with open("/proc/sys/kernel/core_pattern") as pattern: core_pattern = pattern.read().strip()
            except OSError: core_pattern = "unavailable"
            raise RuntimeError(json.dumps({"shim": state(command.pid), "child": state(child), "core_pattern": core_pattern})) from error
        try:
            os.kill(child, 0)
            alive = True
        except ProcessLookupError: alive = False
        results.append({"case": label, "code": code, "child_alive": alive})
    finally:
        for target in [-command.pid, child]:
            if target is not None:
                try: os.kill(target, signal.SIGKILL)
                except ProcessLookupError: pass
        command.wait(timeout=3)
        command.stdout.close()
        command.stderr.close()
print(json.dumps(results))
`, real, join(installed, "herdr"), root], { env: { ...process.env, HERDR_ENV: "1", HERDR_PANE_ID: "owned:p1", HERDR_SOCKET_PATH: join(root, "missing.sock") }, stdin: "ignore", stdout: "pipe", stderr: "pipe" }); children.push(runner);
    const [stdout, stderr, code] = await Promise.all([new Response(runner.stdout).text(), new Response(runner.stderr).text(), runner.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual([{ case: "direct", code: -3, child_alive: false }, { case: "shim", code: -3, child_alive: false }]);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    for (const label of ["direct", "shim"]) try { process.kill(Number(readFileSync(join(root, `${label}.pid`), "utf8").trim()), "SIGKILL"); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
