/** Real App, chat, terminal links and touch selection over fictional demo traffic only. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import fixture from "../site/demo/fixtures/machines.json";
import type { Machine } from "../shared/machines.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";
import { shownRow } from "./shown-rows.ts";

const evidence = process.env.UI_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "ovis-peer-browser-")), app = join(root, "app");
const local = structuredClone(fixture.machines[0]) as Machine;
const receiver = local.snapshot!.panes.find((pane) => pane.agent === "codex")!;
const sourcePane = local.snapshot!.panes.find((pane) => pane.agent === "claude")!;
const remote: Machine = { ...structuredClone(local), id: "peer-source-pc", name: "Peer source PC", kind: "ssh", target: { destination: "fixture.invalid" } };
const id = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
const source = { server_id: "fictional-source-server", boot_id: "fictional-boot", terminal_id: sourcePane.terminal_id!, agent_instance_id: "fictional-process", pane_id: sourcePane.pane_id, agent: "claude", name: "Worker" };
const turns = [id, secondId].map((id) => ({ role: "user", ts: "2026-11-11T01:00:00Z", sender: { id, name: "Worker" }, parts: [{ kind: "text", text: "Identical peer update" }] }));
turns.push({ role: "user", ts: "2026-11-11T01:00:01Z", parts: [{ kind: "text", text: "Ordinary human message" }] } as typeof turns[number]);
const harness = `<script>(() => {
  const machines = ${JSON.stringify([local, remote])}, turns = ${JSON.stringify(turns)}, source = ${JSON.stringify(source)};
  const demo = window.fetch, sockets = [], controls = [], sources = new Set();
  let mode = 'live', resolves = 0;
  window.peerFixture = { sockets, controls, mode(value) { mode = value; resolves = 0; } };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (/\\/pane\\/(focus|input|keys)$/.test(url.pathname)) controls.push(url.pathname);
    if (url.pathname === '/api/machines') return Response.json({ machines });
    if (url.pathname === '/api/session') return Response.json({ snapshot: machines[0].snapshot });
    if (url.pathname.endsWith('/pane/conversation')) return Response.json({source:'codex-transcript',history_id:'peer-fixture',cursor:null,turns});
    if (url.pathname.endsWith('/pane/message-source')) return Response.json({ sender: {id:url.searchParams.get('id'),source} });
    if (url.pathname.endsWith('/pane/message-source/resolve')) {
      if (!url.pathname.includes('/machines/peer-source-pc/')) return Response.json({pane_id:null});
      resolves++;
      return Response.json({pane_id: mode === 'gone' || mode === 'replace' && resolves > 1 ? null : ${JSON.stringify(sourcePane.pane_id)}});
    }
    return demo(input, init);
  };
  const DemoSource = window.EventSource;
  window.EventSource = function(url, options) {
    if (!String(url).includes('/api/machines/events')) return new DemoSource(url, options);
    const events = new EventTarget(); events.readyState = 1; events.close = () => {events.readyState=2;sources.delete(events);};sources.add(events);
    queueMicrotask(() => events.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'machines',machines})})));
    return events;
  };
  const DemoSocket = window.WebSocket;
  window.WebSocket = class extends DemoSocket {
    constructor(...args) { super(...args); sockets.push(this); }
    send(raw) { try { const message=JSON.parse(raw);if(message.type==='input'||message.type==='keys')controls.push(message.type); } catch {} return super.send(raw); }
  };
})();</script>`;
let browser: Browser | undefined, server: ReturnType<typeof Bun.serve> | undefined;
try {
  await buildDemoApp(app);
  const html = readFileSync(join(app, "index.html"), "utf8").replace(/<script type="module"/, `<script src="./demo-transport.js"></script>${harness}<script type="module"`);
  const prefix = "/herdr-web-ui/demo/app/";
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(prefix)) return new Response("not found", { status: 404 });
    const file = path.slice(prefix.length) || "index.html";
    if (file.includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    return file === "index.html" ? new Response(html, { headers: { "content-type": "text/html" } }) : new Response(Bun.file(join(app, file)));
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const width of [1280, 390]) {
    const touch = width === 390;
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, locale: "en-US" });
    try {
      await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme: "dark", defaultView: "chat", terminalFontSize: 14, releasePaneAway: false, alertsOn: false })));
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(15_000);
      const base = `http://127.0.0.1:${server.port}${prefix}`;
      const openReceiver = async (view = "chat") => {
        await page.goto(`${base}?pane=${encodeURIComponent(receiver.pane_id)}&view=${view}`);
        await page.locator(`.pane-frame[data-layout-pane="${receiver.pane_id}"]`).waitFor();
      };
      const press = async () => {
        const button = page.getByRole("button", { name: "Open message source", exact: true }).first();
        if (touch) await button.tap(); else await button.click();
      };
      await openReceiver();
      await page.getByText("Ordinary human message", { exact: true }).waitFor();
      assert.equal(await page.getByText("Peer content from Worker", { exact: true }).count(), 2);
      assert.equal(await page.locator(".chat-turn-user").filter({ hasText: "Ordinary human message" }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (evidence) await page.screenshot({ path: join(evidence, `peer-source-${width}.png`), animations: "disabled" });
      await press();
      await page.waitForFunction(({ pane, machine }) => new URL(location.href).searchParams.get("pane") === pane && new URL(location.href).searchParams.get("machine") === machine, { pane: sourcePane.pane_id, machine: remote.id });
      assert.deepEqual(await page.evaluate(() => (window as unknown as {peerFixture:{controls:string[]}}).peerFixture.controls), []);
      for (const mode of ["gone", "replace"]) {
        await openReceiver();
        await page.evaluate((mode) => (window as unknown as {peerFixture:{mode(mode:string):void}}).peerFixture.mode(mode), mode);
        await press();
        await page.getByText("Message source is unavailable", { exact: true }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get("pane"), receiver.pane_id);
      }
      // The terminal's same logical-line provider is exercised through real mouse and touch events.
      await openReceiver("terminal");
      await page.locator("[data-pane-content]").waitFor();
      await page.evaluate(({ pane, id }) => {
        const fixture = (window as unknown as {peerFixture:{sockets:Array<{push(value:unknown):void}>}}).peerFixture;
        for (const socket of fixture.sockets) socket.push({type:"pty-data",pane_id:pane,data:`\u001b[2J\u001b[HSource: ovis-source://${id}\r\n`});
      }, { pane: receiver.pane_id, id });
      const row = page.locator(shownRow()).filter({ hasText: "Source: ovis-source" }).first();
      await row.waitFor();
      const point = await row.evaluate((element) => {
        const rect = element.getBoundingClientRect(), text = element.querySelector("span")?.firstChild;
        if (!text) throw new Error("missing terminal text");
        const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
        return {x:rect.x+range.getBoundingClientRect().width*18.5,y:rect.y+rect.height/2};
      });
      if (touch) await page.touchscreen.tap(point.x, point.y); else { await page.mouse.move(point.x, point.y); await page.mouse.click(point.x, point.y); }
      await page.waitForFunction((machine) => new URL(location.href).searchParams.get("machine") === machine, remote.id);
      assert.deepEqual(await page.evaluate(() => (window as unknown as {peerFixture:{controls:string[]}}).peerFixture.controls), []);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: peer markers, machine isolation, unavailable/replaced source, terminal ${touch ? "tap" : "click"}, no input or Herdr focus`);
    } finally { await context.close(); }
  }
} finally { await browser?.close(); server?.stop(); rmSync(root, { recursive: true, force: true }); }
