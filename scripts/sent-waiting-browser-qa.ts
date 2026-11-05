/** A disconnected sibling must not strand a sent bubble beside its Codex transcript turn. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { ConversationTurn } from "../shared/protocol.ts";
import type {} from "./chat-virtual-fixture.tsx";
import { chromePath } from "./chrome-path.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-sent-waiting-"));
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const user = (text: string, at: number): ConversationTurn => ({ role: "user", ts: new Date(at).toISOString(), parts: [{ kind: "text", text }] });
let turns: ConversationTurn[] = [];
let history = "sent-waiting";
const message = "This follow-up was sent while the agent was working. It should appear once when the transcript records it, even if another tab has mounted a disconnected pane.";

try {
  const build = await Bun.build({
    entrypoints: ["scripts/chat-virtual-fixture.tsx"], outdir: root, target: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  assert.ok(build.success, String(build.logs));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    assert.equal(request.method, "GET", "the presentation fixture never sends terminal input");
    const url = new URL(request.url);
    if (url.pathname.endsWith("/pane/conversation")) return Response.json({ source: "codex-transcript", history_id: history, turns });
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
      await page.locator(".chat-turn-waiting").waitFor({ state: "detached", timeout: 5_000 });
      assert.equal(await page.locator(".chat-turn-user").filter({ hasText: message }).count(), 1);
      assert.equal(await page.locator(".chat-sent-late").count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: a skewed send replaces its waiting copy after a sibling's disconnected mount`);
    } finally { await context.close(); }
  }
  for (const width of [390, 1280]) for (const machine of ["local", "remote-review-PC"]) {
    for (const scenario of ["new-turn", "old-identical", "restored-copy", "other-history", "two-attempts", "engaged-row"]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, locale: "en-US" });
      try {
        await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en" })));
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        history = "review-history";
        turns = [user(scenario === "old-identical" || scenario === "restored-copy" ? message : "Earlier message", Date.now() - 10_000)];
        await page.goto(`http://127.0.0.1:${server.port}/`);
        await page.evaluate((machine) => window.chatQa.machine(machine), machine);
        await page.locator("[data-chat-row]").first().waitFor();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.evaluate(({ text, capture }) => window.chatQa.recovery(text, "first", capture), { text: message, capture: scenario !== "restored-copy" });
        if (scenario === "engaged-row") {
          await page.locator(".pending-message-saved summary").focus();
          await page.keyboard.press("Enter");
          await page.getByRole("button", { name: "Dismiss saved copy", exact: true }).focus();
        }
        if (scenario === "two-attempts") await page.evaluate((text) => window.chatQa.recovery(text, "second"), message);
        if (scenario !== "old-identical" && scenario !== "restored-copy") turns = [...turns, user(message, Date.now() + 1)];
        if (scenario === "other-history") history = "replacement-history";
        await page.evaluate(() => window.chatQa.refresh());
        if (scenario === "new-turn" || scenario === "engaged-row") {
          if (scenario === "engaged-row") {
            await page.waitForFunction(() => document.querySelectorAll("[data-chat-row]").length === 2);
            assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Dismiss saved copy");
            assert.equal(await page.locator(".pending-message-saved").evaluate((node) => (node as HTMLDetailsElement).open), true);
            assert.equal(await page.locator(".pending-messages-inline").count(), 0);
            await page.locator(".pending-message-saved summary").focus();
          await page.keyboard.press("Enter");
            await page.locator(".chat-view").evaluate((node) => { (node as HTMLElement).tabIndex = -1; (node as HTMLElement).focus(); });
          }
          const inline = page.locator(".chat-turn-user .pending-messages-inline");
          await inline.waitFor();
          assert.ok((await inline.innerText()).includes("Matching message in transcript · receipt unconfirmed"));
          assert.equal(await inline.locator(".pending-message-bubble").isVisible(), false);
          assert.equal(await page.locator(".pending-messages:not(.pending-messages-inline):visible").count(), 0);
          assert.equal(await page.locator(".chat-turn-user").filter({ hasText: message }).count(), 1);
          if (scenario === "new-turn" && width === 1280 && machine !== "local") {
            turns = [...turns, ...Array.from({ length: 300 }, (_, index) => ({ ...user(`Later assistant reply ${index} ${"work details ".repeat(20)}`, Date.now() + index + 2), role: "assistant" as const }))];
            await page.evaluate(() => window.chatQa.refresh());
            await page.locator(".pending-messages:not(.pending-messages-inline)").waitFor();
            assert.equal(await page.locator(".pending-message-bubble:visible").count(), 0, "a virtualized-away turn keeps compact recovery available");
            await page.locator(".chat-view-virtual").evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
            await inline.waitFor();
            assert.equal(await page.locator(".pending-messages:not(.pending-messages-inline):visible").count(), 0);
          }
          await inline.getByRole("button", { name: "Dismiss saved copy", exact: true }).click();
          await page.locator(".pending-messages").waitFor({ state: "detached" });
          assert.equal(await page.locator(".chat-turn-user").filter({ hasText: message }).count(), 1);
        } else {
          const expected = scenario === "two-attempts" ? 2 : 1;
          await page.waitForFunction((expected) => document.querySelectorAll("[data-chat-row]").length === expected, turns.length);
          assert.equal(await page.locator(".pending-messages-inline").count(), 0, scenario);
          assert.equal(await page.locator(".pending-message[data-state=uncertain]").count(), expected);
          assert.equal(await page.locator(".pending-message-bubble:visible").count(), 0, "unknown copies stay folded when no safe association exists");
        }
        assert.equal(await page.locator(".pending-message-send").count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px ${machine} ${scenario}: one message presentation, recovery remains non-resendable`);
      } finally { await context.close(); }
    }
  }
} finally {
  await browser?.close();
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
}
