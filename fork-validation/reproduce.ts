import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const repo = process.env.OVIS_QA_REPO ?? process.cwd();
await import(repo + '/scripts/test-herdr.ts');
const { chromium } = await import(repo + '/node_modules/playwright-core/index.mjs');
const { createServer } = await import(repo + '/server/index.ts');
const { herdrRpc } = await import(repo + '/server/herdr/client.ts');
const { MachineManager } = await import(repo + '/server/machines.ts');
const { DeviceStore } = await import(repo + '/server/devices.ts');
const { DEVICE_COOKIE } = await import(repo + '/server/auth.ts');
const { chromePath } = await import(repo + '/scripts/chrome-path.ts');
const root = mkdtempSync(join(tmpdir(), 'ovis-receipt-browser-'));
const evidence = process.env.OVIS_QA_EVIDENCE ?? '/tmp/ovis-2716-evidence';
mkdirSync(evidence, { recursive: true });
const remoteId = '11111111-1111-4111-8111-111111111111';
const message = 'Please check the receipt fixture once.';
let bridge: any, central: any, browser: any, workspace: string | undefined;
const originalEndpoint = MachineManager.prototype.endpoint;
const originalList = MachineManager.prototype.list;
async function until(check: () => any, label: string) {
  const deadline = Date.now() + 20000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'Timed out: ' + label); await Bun.sleep(25); }
}
try {
  const made = await herdrRpc('workspace.create', { cwd: root, label: 'Receipt recovery fixture', focus: false });
  workspace = made.workspace.workspace_id;
  const pane = made.root_pane.pane_id;
  const log = join(root, 'input.jsonl');
  const program = join(root, 'codex');
  const recorder = join(root, 'record.cjs');
  copyFileSync(process.execPath, program); chmodSync(program, 0o755);
  writeFileSync(recorder, 'const fs=require("node:fs");process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write("\\x1b[?2004h\\n› Message\\n",()=>fs.writeFileSync(process.argv[2],""));process.stdin.on("data",c=>fs.appendFileSync(process.argv[2],JSON.stringify(c.toString())+"\\n"));');
  await herdrRpc('pane.send_text', { pane_id: pane, text: `exec '${program}' '${recorder}' '${log}'\n` });
  await until(() => existsSync(log), 'recorder ready');
  await herdrRpc('pane.report_agent', { pane_id: pane, source: 'manual', agent: 'codex', state: 'working' });
  const bytes = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((s: string) => JSON.parse(s)).join('');
  bridge = createServer({ port: 0, hostname: '127.0.0.1', stateDir: join(root, 'bridge'), token: '', bridgeToken: 'fixture-bridge-token', machines: false });
  const endpoint = { url: `http://127.0.0.1:${bridge.port}`, token: 'fixture-bridge-token' };
  const snapshot = (await (await fetch(endpoint.url + '/api/session', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).snapshot;
  const boot = (await (await fetch(endpoint.url + '/api/health', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).web_ui.boot_id;
  const stateDir = join(root, 'central');
  const devices = new DeviceStore(stateDir);
  const paired = devices.pair(devices.startPairing().code, 'Fixture browser', 'drive')!;
  devices.match(paired.token);
  MachineManager.prototype.endpoint = function(id: string) { return this.stateDir === stateDir && id === remoteId ? endpoint : originalEndpoint.call(this, id); };
  MachineManager.prototype.list = function() { return this.stateDir === stateDir ? [{ id: remoteId, name: 'Receipt fixture PC', kind: 'ssh', enabled: true, state: 'connected', error: null, snapshot, source_boot_id: boot }] : originalList.call(this); };
  central = createServer({ port: 0, hostname: '127.0.0.1', stateDir, token: 'fixture-central-token', tailscaleOwner: null });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--accept-lang=en-US'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  await context.addCookies([{ name: DEVICE_COOKIE, value: paired.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => localStorage.setItem('ovis:settings', JSON.stringify({ language: 'en', defaultView: 'chat', alertsOn: false, autoSendQueued: true })));
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors: string[] = [], frames: any[] = [], outbound: any[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  let admit = true, dropReceipt = false, dropped = false;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket: any) => {
    if (!admit && socket.url().includes('machine_id=' + remoteId)) { void socket.close(); return; }
    const upstream = socket.connectToServer();
    socket.onMessage((raw: any) => { const frame = JSON.parse(String(raw)); outbound.push(frame); upstream.send(raw); });
    upstream.onMessage((raw: any) => {
      const frame = JSON.parse(String(raw)); frames.push(frame);
      if (dropReceipt && frame.type === 'pending-messages' && frame.removed?.some((r: any) => r.outcome === 'sent')) {
        dropReceipt = false; dropped = true; admit = false; void socket.close(); return;
      }
      socket.send(raw);
    });
  });
  await page.goto(`http://127.0.0.1:${central.port}/?machine=${remoteId}&pane=${encodeURIComponent(pane)}&view=chat`);
  await page.locator('.conn-live').waitFor();
  const current = page.locator(`[data-layout-pane="${pane}"]`).and(page.locator('.is-current'));
  await current.waitFor();
  await current.locator('.composer-status[data-status="working"]').waitFor();
  const composer = current.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill(message);
  await current.getByRole('button', { name: 'Send message', exact: true }).click();
  const row = current.locator('.pending-message').filter({ hasText: message });
  await row.waitFor();
  await page.screenshot({ path: join(evidence, '01-queued-remote-follow-up.png') });
  dropReceipt = true;
  await herdrRpc('pane.report_agent', { pane_id: pane, source: 'manual', agent: 'codex', state: 'idle' });
  await until(() => dropped, 'the sent receipt is lost at the browser transport');
  await until(() => bytes().endsWith(`\x1b[200~${message}\x1b[201~\r`), 'one recorded delivery');
  await until(async () => await row.getAttribute('data-state') === 'uncertain', 'Not confirmed after lost receipt');
  await composer.fill('Keep this unsent draft.');
  await page.screenshot({ path: join(evidence, '02-lost-receipt-not-confirmed.png') });
  const before = bytes(), submits = outbound.filter((f: any) => f.type === 'submit').length;
  admit = true;
  await row.waitFor({ state: 'detached' });
  await page.locator('.conn-live').waitFor();
  assert.equal(bytes(), before, 'recovering the receipt types no additional terminal bytes');
  assert.equal(outbound.filter((f: any) => f.type === 'submit').length, submits, 'browser does not resubmit');
  assert.equal(await composer.inputValue(), 'Keep this unsent draft.');
  const recovered = frames.find((f: any) => f.type === 'pending-messages' && f.removed?.some((r: any) => r.outcome === 'sent' && r.resumed === true));
  assert.ok(recovered, 'bridge replayed the exact sent receipt after reattach');
  await page.screenshot({ path: join(evidence, '03-recovered-no-resend.png') });
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, 'browser-result.json'), JSON.stringify({ source: Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repo }).stdout.toString().trim(), isolated: true, nativeAgent: false, simulatedRemoteTransport: 'MachineManager endpoint and roster route to a real loopback bridge', droppedExactSentReceipt: dropped, terminalBytesBeforeReconnect: before.length, terminalBytesAfterReconnect: bytes().length, submitCountBeforeReconnect: submits, submitCountAfterReconnect: outbound.filter((f: any) => f.type === 'submit').length, recoveredOutcome: recovered.removed, draftPreserved: true, pageErrors: errors, screenshots: ['01-queued-remote-follow-up.png','02-lost-receipt-not-confirmed.png','03-recovered-no-resend.png'] }, null, 2) + '\n');
  console.log('PASS real browser through MachineRelay + real bridge: lost sent receipt becomes Not confirmed, then recovers without new terminal bytes or submit; draft preserved');
} finally {
  await browser?.close(); central?.stop(); bridge?.stop();
  MachineManager.prototype.endpoint = originalEndpoint; MachineManager.prototype.list = originalList;
  if (workspace) await herdrRpc('workspace.close', { workspace_id: workspace }).catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
