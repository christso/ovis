/** A disconnected sibling must not strand a sent bubble beside its Codex transcript turn. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = await import(join(process.cwd(), "node_modules/playwright-core/index.mjs"));
import type { ConversationTurn } from "../shared/protocol.ts";
import type {} from "./chat-virtual-fixture.tsx";
const { chromePath } = await import(join(process.cwd(), "scripts/chrome-path.ts"));
const upstream = process.argv.includes("--upstream");
const mode = upstream ? "upstream-main-74dfea3e" : "waiting-baseline-fixed";
const evidence = join(import.meta.dir, "screenshots");
mkdirSync(evidence, { recursive: true });
const results: unknown[] = [];

const root = mkdtempSync(join(tmpdir(), "ovis-sent-waiting-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const user = (text: string, at: number): ConversationTurn => ({ role: "user", ts: new Date(at).toISOString(), parts: [{ kind: "text", text }] });
let turns: ConversationTurn[] = [];
const message = "This follow-up was sent while the agent was working. It should appear once when the transcript records it, even if another tab has mounted a disconnected pane.";

try {
  const build = await Bun.build({
    entrypoints: ["scripts/chat-virtual-fixture.tsx"], outdir: root, target: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "waiting-fixture", setup(build) {
      build.onLoad({ filter: /\/scripts\/chat-virtual-fixture\.tsx$/ }, () => {
        const fixture = spawnSync("git", ["show", "6e09c56e:scripts/chat-virtual-fixture.tsx"], { encoding: "utf8" });
        assert.equal(fixture.status, 0);
        return { contents: fixture.stdout, loader: "tsx", resolveDir: join(process.cwd(), "scripts") };
      });
      if (!upstream) return;
      build.onLoad({ filter: /\/src\/components\/SentWaiting\.tsx$/ }, () => {
        const source = spawnSync("git", ["show", "74dfea3e72de1f26a07e9028aef77d8f77396e67:src/components/SentWaiting.tsx"], { encoding: "utf8" });
        assert.equal(source.status, 0);
        return { contents: source.stdout, loader: "tsx", resolveDir: join(process.cwd(), "src/components") };
      });
    } }],
  });
  assert.ok(build.success, String(build.logs));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    assert.equal(request.method, "GET", "the presentation fixture never sends terminal input");
    const url = new URL(request.url);
    if (url.pathname.endsWith("/pane/conversation")) return Response.json({ source: "codex-transcript", history_id: "sent-waiting", turns });
    if (url.pathname.endsWith("/pane/commands")) return Response.json({ commands: [] });
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/") return new Response('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/chat-virtual-fixture.css"></head><body><div id="root"></div><script type="module" src="/chat-virtual-fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    return new Response(Bun.file(join(root, url.pathname)));
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-US" });
    try {
      await context.addInitScript(() => {
        const now = Date.now;
        Date.now = () => now() + 2_000;
        localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" }));
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      turns = [user("Earlier message", Date.now() - 10_000)];
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.locator("[data-chat-row]").first().waitFor();
      await page.evaluate(() => window.chatQa.siblingConnection(false));
      // Paint the sibling's disconnected mount before the original pane sends.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.evaluate((text) => window.chatQa.send(text), message);
      await page.locator(".chat-turn-waiting").waitFor();
      turns = [...turns, user(message, Date.now())];
      await page.evaluate(() => window.chatQa.refresh());
      await page.waitForFunction(() => document.querySelectorAll("[data-chat-row]").length === 2);
      if (upstream) await page.locator(".chat-sent-late").waitFor({ timeout: 7_000 });
      else await page.locator(".chat-turn-waiting").waitFor({ state: "detached", timeout: 5_000 });
      assert.equal(await page.locator(".chat-turn-user").filter({ hasText: message }).count(), upstream ? 2 : 1);
      assert.equal(await page.locator(".chat-sent-late").count(), upstream ? 1 : 0);
      const waitingCopies = await page.locator(".chat-turn-waiting").count();
      assert.equal(waitingCopies, upstream ? 1 : 0);
      await page.locator(".chat-turn-user").filter({ hasText: message }).first().scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.ok(await page.locator(".chat-turn-user").filter({ hasText: message }).first().evaluate(node => node.getBoundingClientRect().height > 0));
      await page.waitForTimeout(500); // Let the virtual list settle after removing its waiting row.
      await page.locator(".chat-turn-user").filter({ hasText: message }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      assert.ok(await page.locator(".chat-turn-user").filter({ hasText: message }).first().evaluate(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
      const screenshot = `${mode}-${width}.png`;
      await page.screenshot({ path: join(evidence, screenshot), fullPage: true });
      results.push({ mode, width, waitingCopies, transcriptUserTurns: 2, clockOffsetMs: 2000, siblingConnected: false, screenshot });
      assert.deepEqual(errors, []);
      console.log(`PASS ${mode} ${width}px: ${waitingCopies} waiting copies beside the transcript`);
    } finally { await context.close(); }
  }
  writeFileSync(join(import.meta.dir, `${mode}.json`), JSON.stringify({ classification: "synthetic browser fixture; not native-agent dogfooding", upstreamBase: "74dfea3e72de1f26a07e9028aef77d8f77396e67", results }, null, 2) + "\n");
} finally {
  await browser?.close();
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
}
