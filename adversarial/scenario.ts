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
const scenario = process.env.OVIS_QA_CASE ?? 'recover';
const trial = process.env.OVIS_QA_TRIAL ?? '0';
const phone = process.env.OVIS_QA_PHONE === '1';
const jitter = Number(process.env.OVIS_QA_JITTER ?? 0);
const remoteIdB = '22222222-2222-4222-8222-222222222222';
const remoteId = '11111111-1111-4111-8111-111111111111';
const message = 'Please check the receipt fixture once.';
const started = Date.now();
let checks: Record<string, unknown> = {};
let activePage: any, debug: (() => any) | undefined;
async function noBytes(read: () => string, expected: string, duration = 500) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) { assert.equal(read(), expected, 'no automatic/repeated terminal input'); await Bun.sleep(25); }
  assert.equal(read(), expected);
}
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
  mkdirSync(join(root, 'native-codex'), { recursive: true });
  bridge = createServer({ codexHome: join(root, 'native-codex'), port: 0, hostname: '127.0.0.1', stateDir: join(root, 'bridge'), token: '', bridgeToken: 'fixture-bridge-token', machines: false });
  const endpoint = { url: `http://127.0.0.1:${bridge.port}`, token: 'fixture-bridge-token' };
  let snapshot = (await (await fetch(endpoint.url + '/api/session', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).snapshot;
  let boot = (await (await fetch(endpoint.url + '/api/health', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).web_ui.boot_id;
  const stateDir = join(root, 'central');
  const devices = new DeviceStore(stateDir);
  const pair = (label: string, role: 'drive' | 'watch') => { const p = devices.pair(devices.startPairing().code, label, role)!; devices.match(p.token); return p; };
  const paired = pair('Fixture browser', 'drive');
  const other = pair('Other device', 'drive'), watcher = pair('Watcher', 'watch');
  MachineManager.prototype.endpoint = function(id: string) { return this.stateDir === stateDir && [remoteId, remoteIdB].includes(id) ? endpoint : originalEndpoint.call(this, id); };
  MachineManager.prototype.list = function() { return this.stateDir === stateDir ? [{ id: remoteId, name: 'Receipt fixture PC', kind: 'ssh', enabled: true, state: 'connected', error: null, snapshot, source_boot_id: boot }] : originalList.call(this); };
  central = createServer({ codexHome: join(root, 'native-codex'), port: 0, hostname: '127.0.0.1', stateDir, token: 'fixture-central-token', tailscaleOwner: null });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--accept-lang=en-US'] });
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: phone, hasTouch: phone, locale: 'en-US' });
  await context.addCookies([{ name: DEVICE_COOKIE, value: paired.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(() => localStorage.setItem('ovis:settings', JSON.stringify({ language: 'en', defaultView: 'chat', alertsOn: false, autoSendQueued: true })));
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(20000);
  const errors: string[] = [], frames: any[] = [], outbound: any[] = [];
  debug = () => ({ frames: frames.filter((f: any) => ['submit-result','input-ready','error','role-ack'].includes(f.type)), outbound: outbound.filter((f: any) => ['attach','submit','pending-action','role'].includes(f.type)), errors });
  page.on('pageerror', (e: Error) => errors.push(e.message));
  let admit = true, dropReceipt = false, dropped = false, denied = 0, live: any, heldAttach: (() => void) | undefined;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket: any) => {
    if (!admit && socket.url().includes('machine_id=' + remoteId)) { denied++; void socket.close(); return; }
    if (socket.url().includes('machine_id=' + remoteId)) live = socket;
    const upstream = socket.connectToServer();
    socket.onMessage((raw: any) => { const frame = JSON.parse(String(raw)); outbound.push(frame); if (scenario === 'early-submit' && !heldAttach && frame.type === 'attach' && socket.url().includes('machine_id=' + remoteId)) { heldAttach = () => upstream.send(raw); return; } upstream.send(raw); });
    upstream.onMessage((raw: any) => {
      const frame = JSON.parse(String(raw)); frames.push(frame);
      if (dropReceipt && frame.type === 'pending-messages' && frame.removed?.some((r: any) => r.outcome === 'sent')) {
        dropReceipt = false; dropped = true; admit = false;
        if (jitter) setTimeout(() => void socket.close(), jitter); else void socket.close();
        return;
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
  if (scenario !== 'early-submit') await until(() => frames.some((f: any) => f.type === 'input-ready' && f.pane_id === pane && f.ready !== false), 'initial input lease is ready');
  await composer.fill(message);
  await current.getByRole('button', { name: 'Send message', exact: true }).click();
  await until(() => frames.some((f: any) => f.type === 'submit-result'), 'first submit answered');
  const firstResult = frames.find((f: any) => f.type === 'submit-result');
  if (scenario === 'early-submit') {
    assert.equal(firstResult.ok, false); assert.equal(firstResult.code, 'input_not_ready');
    assert.equal(await composer.inputValue(), message, 'refused early submit preserves the draft');
    assert.equal(bytes(), '', 'pre-ready submit types nothing');
    assert.ok(heldAttach); heldAttach();
    await until(() => frames.some((f: any) => f.type === 'input-ready' && f.pane_id === pane && f.ready !== false), 'explicit retry has an input lease');
    await page.screenshot({ path: join(evidence, 'early-submit-refused.png') });
    await current.getByRole('button', { name: 'Send message', exact: true }).click();
    await until(() => frames.some((f: any) => f.type === 'submit-result' && f.ok && f.pending), 'explicit retry accepted');
    checks.earlySubmitSafelyRefused = true; checks.refusedDraftPreserved = true; checks.explicitRetryRequired = true;
  } else assert.equal(firstResult.ok, true, 'ready submit accepted: ' + JSON.stringify(firstResult));
  const row = current.locator('.pending-message').filter({ hasText: message });
  await row.waitFor();
  if (scenario === 'disconnect-before-delivery') {
    admit = false; await live.close();
    await until(async () => await row.getAttribute('data-state') === 'uncertain', 'disconnected queued copy is uncertain');
    await noBytes(bytes, '');
    await herdrRpc('pane.report_agent', { pane_id: pane, source: 'manual', agent: 'codex', state: 'idle' });
    await noBytes(bytes, '');
  } else {
    dropReceipt = true;
    await herdrRpc('pane.report_agent', { pane_id: pane, source: 'manual', agent: 'codex', state: 'idle' });
    await until(() => dropped, 'the sent receipt is lost at the browser transport');
    await until(() => bytes().endsWith(`\x1b[200~${message}\x1b[201~\r`), 'one recorded delivery');
    await until(async () => await row.getAttribute('data-state') === 'uncertain', 'Not confirmed after lost receipt');
  }
  assert.equal(await row.locator('.pending-message-send').count(), 0, 'no Send now on uncertain input');
  assert.equal(await row.getByRole('button', { name: 'Copy message', exact: true }).isEnabled(), true);
  assert.equal(await row.getByRole('button', { name: 'Discard saved copy', exact: true }).isEnabled(), true);
  await composer.fill('Keep this unsent draft.');
  const before = bytes(), submits = outbound.filter((f: any) => f.type === 'submit').length;
  const originalResumeId = await page.evaluate(() => localStorage.getItem('ovis:pi-receipt-resume'));
  const ownerId = frames.find((f: any) => f.type === 'submit-result' && f.pending)?.pending.id;
  assert.ok(ownerId && originalResumeId);
  const receiptFrom = frames.length;
  if (scenario === 'flaps') await until(() => denied >= 3, 'three refused reconnect attempts');
  if (scenario === 'isolation') {
    for (const [label, device, pc] of [['other-device', other, remoteId], ['watcher', watcher, remoteId], ['other-PC', paired, remoteIdB]] as const) {
      const stranger = await browser.newContext();
      await stranger.addCookies([{ name: DEVICE_COOKIE, value: device.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
      const tab = await stranger.newPage();
      await tab.goto(`http://127.0.0.1:${central.port}/api/health?scope=bridge`);
      const removed = await tab.evaluate(async ({ pc, pane, resumeId }: any) => await new Promise<any[]>((resolve, reject) => {
        const ws = new WebSocket(`ws://${location.host}/ws?machine_id=${pc}`);
        const receipts: any[] = [];
        const timeout = setTimeout(() => { ws.close(); reject(new Error('stranger attach timed out')); }, 10000);
        let pinged = false;
        ws.onmessage = (event) => {
          const frame = JSON.parse(event.data);
          if (frame.type === 'snapshot') ws.send(JSON.stringify({ type: 'attach', pane_id: pane, cols: 100, rows: 30, keep_size: true, receipt_resume_id: resumeId }));
          if (frame.type === 'pending-messages') receipts.push(...(frame.removed ?? []));
          if (frame.type === 'input-ready' && !pinged) { pinged = true; ws.send(JSON.stringify({ type: 'ping', id: 868 })); }
          if (frame.type === 'pong' && frame.id === 868) { clearTimeout(timeout); ws.close(); resolve(receipts); }
        };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('stranger websocket error')); };
      }), { pc, pane, resumeId: originalResumeId });
      assert.equal(removed.some((item: any) => item.id === ownerId), false, label + ' cannot recover owner receipt');
      await stranger.close();
    }
    checks.deviceWatcherPcIsolation = true;
  }
  if (scenario === 'bridge-restart') {
    bridge.stop();
    bridge = createServer({ codexHome: join(root, 'native-codex'), port: 0, hostname: '127.0.0.1', stateDir: join(root, 'bridge'), token: '', bridgeToken: 'fixture-bridge-token', machines: false });
    endpoint.url = `http://127.0.0.1:${bridge.port}`;
    snapshot = (await (await fetch(endpoint.url + '/api/session', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).snapshot;
    boot = (await (await fetch(endpoint.url + '/api/health', { headers: { authorization: 'Bearer ' + endpoint.token } })).json()).web_ui.boot_id;
  }
  if (scenario === 'central-restart') {
    const saved = await page.evaluate(() => Object.entries(localStorage));
    central.stop();
    central = createServer({ codexHome: join(root, 'native-codex'), port: 0, hostname: '127.0.0.1', stateDir, token: 'fixture-central-token', tailscaleOwner: null });
    await page.addInitScript((entries: any) => { for (const [key, value] of entries) localStorage.setItem(key, value); }, saved);
    admit = true;
    await page.goto(`http://127.0.0.1:${central.port}/?machine=${remoteId}&pane=${encodeURIComponent(pane)}&view=chat`);
    checks.restartStorageCopiedAcrossEphemeralOrigins = true;
  }
  if (scenario === 'invalid-resume-id') {
    await page.evaluate(() => localStorage.setItem('ovis:pi-receipt-resume', 'not-a-uuid'));
    await page.reload();
  }
  if (scenario === 'reload') await page.reload();
  if (scenario === 'discard-saved-copy') {
    await row.getByRole('button', { name: 'Discard saved copy', exact: true }).click();
    await row.waitFor({ state: 'detached' });
  }
  const missing = ['bridge-restart', 'central-restart', 'disconnect-before-delivery', 'invalid-resume-id'].includes(scenario);
  admit = true;
  await until(() => frames.slice(receiptFrom).some((f: any) => f.type === 'input-ready'), 'reconnect attached to real bridge');
  await page.locator('.conn-live').waitFor();
  const recovered = () => frames.slice(receiptFrom).find((f: any) => f.type === 'pending-messages' && f.removed?.some((r: any) => r.id === ownerId && r.outcome === 'sent' && r.resumed === true));
  if (missing) {
    await until(async () => await row.getAttribute('data-state') === 'uncertain', 'missing proof stays Not confirmed');
    await noBytes(bytes, before, 750);
    assert.equal(recovered(), undefined, 'no fabricated sent receipt');
    assert.equal(await row.locator('.pending-message-send').count(), 0);
    await row.getByRole('button', { name: 'Discard saved copy', exact: true }).click();
    await row.waitFor({ state: 'detached' });
    checks.missingReceiptStayedUnconfirmed = true;
    checks.savedCopyDiscardable = true;
  } else {
    await until(() => !!recovered(), 'exact sent receipt resumed');
    await row.waitFor({ state: 'detached' });
    await noBytes(bytes, before, 250);
  }
  assert.equal(bytes(), before, 'recovering the receipt types no additional terminal bytes');
  assert.equal(outbound.filter((f: any) => f.type === 'submit').length, submits, 'browser does not resubmit');
  assert.equal(await composer.inputValue(), 'Keep this unsent draft.');
  if (scenario === 'invalid-resume-id') assert.match(await page.evaluate(() => localStorage.getItem('ovis:pi-receipt-resume')), /^[a-f0-9-]{36}$/);
  if (['bridge-restart', 'central-restart', 'invalid-resume-id', 'discard-saved-copy'].includes(scenario)) await page.screenshot({ path: join(evidence, 'result.png') });
  assert.deepEqual(errors, []);
  const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: repo }).stdout.toString().trim();
  writeFileSync(join(evidence, 'browser-result.json'), JSON.stringify({ source: revision, build: JSON.parse(readFileSync(join(repo, 'dist/build.json'), 'utf8')), scenario, trial, phone, jitter, durationMs: Date.now() - started, isolated: true, nativeAgent: false, droppedExactSentReceipt: dropped, terminalBytesBeforeReconnect: before.length, terminalBytesAfterReconnect: bytes().length, submitCountBeforeReconnect: submits, submitCountAfterReconnect: outbound.filter((f: any) => f.type === 'submit').length, originalPendingId: ownerId, recoveredOutcome: recovered()?.removed ?? [], draftPreserved: true, uncertainCopyOffersNoSendNow: true, checks, pageErrors: errors }, null, 2) + '\n');
  console.log('PASS', revision.slice(0, 8), scenario, phone ? 'phone' : 'desktop', trial, 'bytes', before.length, '->', bytes().length, 'submit', submits, '->', outbound.filter((f: any) => f.type === 'submit').length);
} catch (error) {
  writeFileSync(join(evidence, 'failure.json'), JSON.stringify({ scenario, trial, message: String(error), debug: debug?.() }, null, 2));
  await activePage?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); central?.stop(); bridge?.stop();
  MachineManager.prototype.endpoint = originalEndpoint; MachineManager.prototype.list = originalList;
  if (workspace) await herdrRpc('workspace.close', { workspace_id: workspace }).catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
