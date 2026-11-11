/** Real Settings UI and authenticated HTTP, with a fictional setup service; no user shell files. */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import type { CommunicationTrackingStatus } from "../shared/communication-tracking.ts";
import { createServer } from "../server/index.ts";
import { UsageService } from "../server/usage.ts";
import { chromePath } from "./chrome-path.ts";
import { openSettingsPage } from "./settings-page.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-tracking-browser-"));
const token = "tracking-browser-fixture";
let current: CommunicationTrackingStatus = { state: "disabled", shell: "bash", profiles: ["/fictional/home/.bashrc", "/fictional/home/.profile"], detail: null, can_manage: true };
let enables = 0, disables = 0, failEnable = false;
const service = {
  async status() { return { ...current }; },
  async enable() {
    enables++;
    if (failEnable) throw new Error("Fictional installation failure");
    current = { ...current, state: "enabled" };
    return { ...current };
  },
  async disable() { disables++; current = { ...current, state: "disabled" }; return { ...current }; },
};
let browser: Browser | undefined;
const server = createServer({ port: 0, hostname: "127.0.0.1", token, stateDir: join(root, "state"), sidecar: false,
  tailscaleOwner: null, usage: new UsageService(undefined, []), communicationTracking: service });
try {
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const width of [1280, 390, 320]) {
    current = { ...current, state: "disabled", shell: "bash", profiles: ["/fictional/home/.bashrc", "/fictional/home/.profile"], detail: null };
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-US", extraHTTPHeaders: { authorization: `Bearer ${token}` } });
    await context.addInitScript(() => localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", showUsage: false })));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.locator(".conn-live").waitFor();
    const open = async () => { await page.keyboard.press("ControlOrMeta+Shift+Comma"); await openSettingsPage(page, "Agents"); };
    await open();
    const row = page.locator('[data-section="communication-tracking"]');
    await row.getByText("Communication tracking", { exact: true }).waitFor({ timeout: 5000 });
    const before = enables;
    await row.getByRole("button", { name: "Enable communication tracking", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "Enable communication tracking?" });
    await confirmation.getByText("/fictional/home/.bashrc", { exact: false }).waitFor();
    assert.equal(await confirmation.getByRole("button", { name: "Cancel", exact: true }).evaluate((button) => document.activeElement === button), true, "confirmation starts with Cancel focused");
    assert.equal(enables, before, "opening confirmation does not install");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(enables, before, "Cancel never installs");
    await row.getByRole("button", { name: "Enable communication tracking", exact: true }).click();
    await confirmation.getByRole("button", { name: "Enable", exact: true }).click();
    await row.getByText("Enabled for new Herdr terminals. Relaunch existing agents to use it.", { exact: true }).waitFor();
    assert.equal(enables, before + 1);
    await page.reload();
    await page.locator(".conn-live").waitFor();
    await open();
    await row.getByRole("button", { name: "Disable communication tracking", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Disable communication tracking?" }).getByRole("button", { name: "Disable", exact: true }).click();
    await row.getByRole("button", { name: "Enable communication tracking", exact: true }).waitFor();
    assert.ok(disables > 0);
    failEnable = true;
    await row.getByRole("button", { name: "Enable communication tracking", exact: true }).click();
    await confirmation.getByRole("button", { name: "Enable", exact: true }).click();
    await confirmation.getByRole("alert").waitFor();
    assert.equal(await confirmation.isVisible(), true, "installation error remains in confirmation for retry");
    failEnable = false;
    await confirmation.getByRole("button", { name: "Enable", exact: true }).click();
    await row.getByRole("button", { name: "Disable communication tracking", exact: true }).waitFor();
    await page.locator(".modal-scrim:has(> .confirm-dialog)").waitFor({ state: "hidden" });
    if (process.env["UI_EVIDENCE_DIR"]) {
      // Phone exit frames live in inert closed shadow roots until their slide finishes.
      await page.waitForFunction(() => document.querySelectorAll('body > div[inert][aria-hidden="true"]').length === 0);
      mkdirSync(process.env["UI_EVIDENCE_DIR"], { recursive: true });
      await page.screenshot({ path: join(process.env["UI_EVIDENCE_DIR"], `communication-tracking-${width}.png`) });
    }
    current = { ...current, state: "needs_attention", detail: "Fictional changed shell setup" };
    await row.getByRole("button", { name: "Check communication tracking", exact: true }).click();
    await row.getByText("Setup needs attention. Check the details below, then retry or disable tracking.", { exact: true }).waitFor();
    assert.equal(await row.getByRole("button", { name: "Enable communication tracking", exact: true }).count(), 1);
    assert.equal(await row.getByRole("button", { name: "Disable communication tracking", exact: true }).count(), 1);
    assert.equal(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, "tracking row fits the viewport");
    current = { ...current, state: "unsupported", shell: null, profiles: [], detail: "Fictional unsupported shell" };
    await row.getByRole("button", { name: "Check communication tracking", exact: true }).click();
    await row.getByText("Communication tracking setup is unavailable on this PC.", { exact: true }).waitFor();
    assert.equal(await row.getByRole("button", { name: /(?:Enable|Disable) communication tracking/ }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS communication tracking confirmation, cancel, enable, reload, disable, retry and unsupported state at ${width}px`);
  }
} finally {
  await browser?.close();
  server.stop();
  rmSync(root, { recursive: true, force: true });
}
