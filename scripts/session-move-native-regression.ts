/** Actual Codex native resume + filesystem/HTTP transfer. Herdr identity and authentication are labeled fixtures; no SSH/model/user sessions. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import roster from "../site/demo/fixtures/machines.json";
import { moveFlowFixture } from "../server/session-move/flow.fixture.ts";
import { nativeFlowDriver } from "./session-move-native-fixture.ts";
import { jsonResponse } from "../server/http.ts";
import type { Machine } from "../shared/machines.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

const driver = nativeFlowDriver(), fixture = await moveFlowFixture(driver);
const evidence = process.env["UI_EVIDENCE_DIR"];
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let phase = "Owned Codex client open. First preview while it is open.", inspected: unknown = null;
const base = structuredClone(roster.machines[0]!) as Machine;
const publicMachines = () => [base, ...fixture.machines().map((machine) => {
  const pane = machine.snapshot!.panes[0]!, template = base.snapshot!.panes.find((pane) => pane.agent === "codex")!;
  return { ...machine, snapshot: { ...base.snapshot!, ...machine.snapshot, workspaces: [{ ...base.snapshot!.workspaces[0]!, ...machine.snapshot!.workspaces[0] }], tabs: [{ ...base.snapshot!.tabs[0]!, workspace_id: "owned-workspace", tab_id: "owned-tab" }], panes: [{ ...template, ...pane, tab_id: "owned-tab" }] } };
})];
const app = join(fixture.root, "app");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  await driver.initialize(fixture.home, fixture.source, fixture.root);
  await buildDemoApp(app);
  const index = join(app, "index.html");
  const harness = `<script>(() => {
    const network = window.moveNativeNetwork, demo = window.fetch;
    window.fetch = (input,init) => { const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
      return ['/api/flock','/api/session-moves','/api/machines'].includes(path)||path.startsWith('/fixture/')?network(input,init):demo(input,init); };
    const Old=window.EventSource;window.EventSource=function(url,opts){if(!String(url).includes('/api/machines/events'))return new Old(url,opts);
      const event=new EventTarget();event.readyState=1;let last='';const emit=async()=>{if(event.readyState!==1)return;const data=JSON.stringify({type:'machines',...(await(await network('/api/machines')).json())});if(data!==last){last=data;event.dispatchEvent(new MessageEvent('message',{data}));}};
      const timer=setInterval(emit,400);event.close=()=>{event.readyState=2;clearInterval(timer);};queueMicrotask(emit);return event;};
    window.addEventListener('DOMContentLoaded',()=>{const panel=document.createElement('aside');panel.id='native-evidence';panel.style='position:fixed;left:8px;bottom:8px;width:400px;max-height:800px;overflow:auto;z-index:10001;background:#151515;color:#fff;border:1px solid #aaa;padding:12px;font:13px system-ui';
      panel.innerHTML='<strong>ACTUAL Codex 0.166 native test</strong><p>Two owned loopback runtime endpoints. Synthetic conversation; fixture Herdr/auth. No SSH, model calls or user sessions.</p><p>SHA ${sha.slice(0,12)}</p><p id="native-phase"></p><button id="native-exit">Exit owned native test client (EOF)</button><button id="native-inspect">Inspect native transcript + Git work</button><pre id="native-proof" style="white-space:pre-wrap"></pre>';
      document.body.append(panel);panel.querySelector('#native-exit').onclick=async()=>{await network('/fixture/exit',{method:'POST'});};panel.querySelector('#native-inspect').onclick=async()=>{await network('/fixture/inspect',{method:'POST'});};
      setInterval(async()=>{const state=await(await network('/fixture/status')).json();panel.querySelector('#native-phase').textContent=state.phase;panel.querySelector('#native-proof').textContent=state.proof?JSON.stringify(state.proof,null,2):'';},350);
    });
  })();</script>`;
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, () => `<script>window.moveNativeNetwork=window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness}<script type="module"`));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api/machines") return jsonResponse({ machines: publicMachines() });
    if (path === "/api/flock") return jsonResponse({ ...fixture.flock.read(), sources: publicMachines() });
    if (path === "/api/session-moves") return fixture.api(request);
    if (path === "/fixture/exit" && request.method === "POST") { await fixture.exit(); phase = "Owned native client exited by EOF. Its actual writer lock can now be acquired. Refresh preview."; return jsonResponse({ exited: true }); }
    if (path === "/fixture/inspect" && request.method === "POST") {
      const transcript = JSON.stringify(await driver.inspect());
      assert.match(transcript, /Preserve this owned conversation/); assert.match(transcript, /Owned conversation retained/);
      const work = fixture.verifyWork(); assert.equal(work.staged, "staged\n"); assert.equal(work.working, "working\n"); assert.equal(work.selected, "selected work\n");
      const messages: string[] = [];
      const collect = (value: unknown): void => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "text" && typeof item === "string") messages.push(item); else if (typeof item === "object") collect(item); } };
      collect(JSON.parse(transcript));
      inspected = { native: messages, git: work, execution_counts: fixture.counts() };
      phase = "Actual native transcript verified at relocated cwd; staged/working/selected work verified. Exactly one destination launch.";
      return jsonResponse(inspected);
    }
    if (path === "/fixture/status") return jsonResponse({ phase, proof: inspected });
    if (path === "/fixture/fail-launch" && request.method === "POST") { fixture.failLaunch(); phase = "Injecting one lost HTTP acknowledgement AFTER real native resume; recovery must inspect, not launch again."; return jsonResponse({ injected: true }); }
    const file = Bun.file(join(app, path === "/" ? "index.html" : decodeURIComponent(path)));
    return await file.exists() ? new Response(file) : new Response("not found", { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, slowMo: evidence ? 1000 : 0, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "en-US", ...(evidence ? { recordVideo: { dir: join(fixture.root, "video"), size: { width: 1600, height: 1000 } } } : {}) });
  const page = await context.newPage();
  await page.goto(server.url.origin);
  await page.getByRole("button", { name: "Table", exact: true }).first().click();
  const row = page.getByRole("row").filter({ hasText: "Owned logical session" });
  await row.getByRole("button", { name: "Move session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move session", exact: true });
  await dialog.getByLabel("Destination PC", { exact: true }).selectOption("owned-destination");
  await dialog.getByLabel("Destination checkout", { exact: true }).fill(fixture.target);
  await dialog.getByRole("button", { name: "Preview transfer", exact: true }).click();
  await dialog.getByLabel("selected.txt", { exact: true }).check();
  await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
  if (evidence) {
    // fixed wait: hold the verified preview legibly in the owner-requested recording; never synchronizes a behavior assertion.
    await Bun.sleep(2000);
  }
  await dialog.getByLabel("I finished the turn and exited this session in Codex.").check();
  await dialog.getByRole("button", { name: "Move session", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Codex still owns this session" }).waitFor();
  assert.equal(fixture.counts().launches, 0);
  if (evidence) {
    // fixed wait: keep the already-asserted native lock refusal readable in the recording.
    await Bun.sleep(2500);
  }
  if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, "native-source-refusal.png") }); }
  await page.locator("#native-exit").click();
  await dialog.getByRole("button", { name: "Refresh preview", exact: true }).click();
  await dialog.getByLabel("I finished the turn and exited this session in Codex.").check();
  await page.request.post(server.url.origin + "/fixture/fail-launch");
  await dialog.getByRole("button", { name: "Move session", exact: true }).click();
  await dialog.getByRole("button", { name: "Check destination", exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((node) => node.textContent?.includes("could not continue")));
  assert.equal(fixture.flock.read().sessions[0]!.current_execution_id, fixture.request.source_execution_id);
  if (evidence) {
    await page.screenshot({ path: join(evidence, "native-lost-ack.png") });
    // fixed wait: keep the already-asserted recoverable lost-acknowledgement state readable in the recording.
    await Bun.sleep(2500);
  }
  await dialog.getByRole("button", { name: "Check destination", exact: true }).click();
  await dialog.getByText("Session moved", { exact: true }).waitFor({ timeout: 30_000 });
  await page.locator("#native-inspect").click();
  await page.locator("#native-proof").filter({ hasText: "Owned conversation retained" }).waitFor();
  assert.deepEqual(fixture.counts(), { creates: 1, launches: 1 });
  assert.equal(fixture.flock.read().executions.length, 2);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Open moved session" && !button.disabled));
  if (evidence) {
    await page.screenshot({ path: join(evidence, "native-complete-proof.png") });
    // fixed wait: leave independently asserted native transcript, dirty-work bytes and execution counts legible in the recording.
    await Bun.sleep(5000);
  }
  const video = page.video(); await context.close();
  if (evidence && video) {
    const path = join(evidence, `native-move-${sha.slice(0,12)}.mp4`);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", await video.path(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path]);
    writeFileSync(join(evidence, "native-evidence.json"), JSON.stringify({ sha, video: path, native: "installed Codex 0.166.0", transport: "two owned loopback HTTP runtime endpoints", fixtures: ["synthetic conversation", "Herdr identity/launch", "authentication capability"], model_calls: 0, user_sessions: 0, assertions: ["loaded native source refused", "explicit owned native EOF exit", "scoped dirty work", "real native destination resume", "lost launch acknowledgement reconciled", "one destination execution", "stable logical ID/name/work"] }, null, 2));
    console.log(`Native workflow MP4: ${path}`);
  }
  console.log("PASS actual installed-native browser transfer; fixture Herdr/auth, two loopback endpoints, no SSH/model/user sessions");
} finally { await browser?.close(); server?.stop(true); await fixture.close(); if (!evidence) rmSync(app, { recursive: true, force: true }); }
