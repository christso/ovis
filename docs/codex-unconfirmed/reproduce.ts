// Run from the repository root: bun run check run bun docs/codex-unconfirmed/reproduce.ts
// Uses a byte-recording Codex stand-in and fictional native-format transcript, not a model.
import "../../scripts/test-herdr.ts";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "../../scripts/chrome-path.ts";
import { createServer } from "../../server/index.ts";
import { herdrRpc, workspaceCreate, workspaceClose } from "../../server/herdr/client.ts";
import { UsageService } from "../../server/usage.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-unconfirmed-"));
const output = resolve(process.env.UI_EVIDENCE_DIR ?? "evidence/codex-unconfirmed");
mkdirSync(output, { recursive: true });
const recovery = process.env.EXPECT_RECEIPT_RECOVERY === "1";
const codexHome = join(root, "home");
const rollout = join(codexHome, "sessions", "rollout.jsonl");
mkdirSync(join(codexHome, "sessions"), { recursive: true });
const record = (role: string, text: string) => JSON.stringify({ type: "response_item", timestamp: new Date().toISOString(), payload: { type: "message", role, ...(role === "assistant" ? { phase: "final_answer" } : {}), content: [{ type: role === "user" ? "input_text" : "output_text", text }] } });
writeFileSync(rollout, JSON.stringify({ type: "session_meta", payload: { id: "01900000-0000-7000-8000-000000000001", cwd: root } }) + "\n");
copyFileSync(process.execPath, join(root, "codex")); chmodSync(join(root, "codex"), 0o755);
writeFileSync(join(root, "record.cjs"), `const fs=require('node:fs');const rolloutFd=fs.openSync(process.argv[3],'a');process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\\x1b[?2004h\\n› Message\\n');fs.writeFileSync(process.argv[2],'');process.stdin.on('data',c=>fs.appendFileSync(process.argv[2],JSON.stringify(c.toString('utf8'))+'\\n'));`);
const log = join(root, "input.jsonl");
let workspace: string | undefined;
let server: ReturnType<typeof createServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: import("playwright-core").Page | undefined;
const until = async (check: () => boolean | Promise<boolean>, label: string) => {
  const deadline = Date.now() + 20_000;
  while (!await check()) { assert.ok(Date.now() < deadline, label); await Bun.sleep(30); }
};
try {
  const created = await workspaceCreate({ cwd: root, label: "Codex receipt reproduction" });
  workspace = created.workspace.workspace_id;
  const pane = created.root_pane.pane_id;
  await herdrRpc("pane.send_text", { pane_id: pane, text: `exec '${join(root, "codex")}' '${join(root, "record.cjs")}' '${log}' '${rollout}'\n` });
  await until(() => existsSync(log), "recorder starts");
  const report = (state: string) => herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "codex", state, agent_session_path: rollout });
  await report("working");
  server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state"), codexHome, usage: new UsageService(undefined, []) });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, locale: "en-US" });
  await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", defaultView: "chat", alertsOn: false, autoSendQueued: true, showUsage: false })));
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const events: unknown[] = [];
  let loseReceipt = false, dropped = false, connections = 0, inputReady = false;
  await page.routeWebSocket(/\/ws(?:\?|$)/, socket => {
    const upstream = socket.connectToServer(); connections++;
    socket.onMessage(data => {
      const frame = JSON.parse(String(data));
      if (frame.type === "attach" || frame.type === "detach") inputReady = false;
      upstream.send(data);
    });
    upstream.onMessage(data => {
      const frame = JSON.parse(String(data));
      if (frame.type === "input-ready" && frame.pane_id === pane) inputReady = frame.ready !== false;
      if (frame.type === "pending-messages") events.push(frame);
      if (loseReceipt && !dropped && frame.type === "pending-messages" && frame.removed?.some((x: { outcome: string }) => x.outcome === "sent")) {
        dropped = true;
        // Delivery succeeded. Simulate the connection dying before its receipt reaches the page.
        void socket.close({ code: 1012, reason: "reproduction: lost delivery receipt" });
        return;
      }
      socket.send(data);
    });
  });
  await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}&view=chat`);
  await page.locator(".conn-live").waitFor();
  const panel = page.locator(`[data-layout-pane="${pane}"].is-current`);
  const rows = panel.locator(".pending-message");
  const bytes = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).join("");
  let expected = "";
  const run = async (text: string, lose: boolean) => {
    await report("working");
    await panel.locator('.composer-status[data-status="working"]').waitFor();
    await until(() => inputReady, "the browser owns a ready input lease");
    await panel.getByRole("textbox", { name: "Message", exact: true }).fill(text);
    await panel.getByRole("button", { name: "Send message", exact: true }).click();
    await until(async () => await rows.filter({ hasText: text }).getAttribute("data-state") === "queued", "message accepted into queue");
    loseReceipt = lose;
    await report("idle");
    expected += `\u001b[200~${text}\u001b[201~\r`;
    await until(() => bytes() === expected, "recorder receives exactly one paste and Enter");
    // The stand-in's completed answer is written only after the real input bytes arrive.
    const answer = lose ? "Processed the follow-up. The receipt-loss reproduction is complete." : "Control message processed successfully.";
    const old = readFileSync(rollout, "utf8");
    writeFileSync(rollout, old + record("user", text) + "\n" + record("assistant", answer) + "\n");
    await report("idle");
    if (!lose) await until(async () => await rows.count() === 0, "control delivery removes its pending row");
    return answer;
  };
  await run("Control: acknowledge this message.", false);
  const text = "Follow-up: confirm the receipt-loss reproduction.";
  const answer = await run(text, true);
  await until(() => dropped && connections >= 2, "page reconnects after losing the delivery receipt");
  if (recovery) await until(async () => await rows.count() === 0, "the resumed exact receipt settles the recovery copy");
  else await until(async () => await rows.filter({ hasText: text }).getAttribute("data-state") === "uncertain", "delivered message remains Not confirmed");
  await page.reload();
  await page.locator(".conn-live").waitFor();
  await panel.getByText(answer, { exact: true }).waitFor();
  const transcript = await (await page.request.get(`http://127.0.0.1:${server.port}/api/pane/conversation?pane_id=${encodeURIComponent(pane)}`)).json();
  assert.equal(transcript.source, "codex-transcript");
  assert.ok(JSON.stringify(transcript.turns).includes(answer));
  if (recovery) assert.equal(await rows.count(), 0, "the settled copy stays gone after reload");
  else await until(async () => await rows.filter({ hasText: text }).getAttribute("data-state") === "uncertain", "Not confirmed survives reload despite completed native transcript");
  assert.equal(bytes(), expected, "reconnect and reload never resend either message");
  await panel.screenshot({ path: join(output, recovery ? "codex-confirmed.png" : "codex-not-confirmed.png") });
  const summary = { revision: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(), recovery, agent: "byte-recording stand-in, fictional Codex-format transcript; no native Codex/model run", control: "one delivery, row removed", receiptLoss: recovery ? "one delivery; lost sent receipt replayed after reconnect; no recovery row after reconnect or reload" : "one delivery; sent receipt lost before browser; reconnect and reload leave uncertain row", nativeTranscript: "completed user and assistant turns visible in Chat", replayed: false, connections, pendingEvents: events };
  writeFileSync(join(output, recovery ? "result-fixed.json" : "result.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (page) console.error("UI at failure", (await page.locator("body").innerText()).slice(-4500));
  throw error;
} finally {
  await browser?.close(); server?.stop();
  if (workspace) await workspaceClose(workspace);
  rmSync(root, { recursive: true, force: true });
}
