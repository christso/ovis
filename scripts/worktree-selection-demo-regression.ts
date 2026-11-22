import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";
import { serveDemo } from "./demo-server.ts";

const app = mkdtempSync(join(tmpdir(), "herdr-worktree-selection-"));
try {
  await buildDemoApp(app);
  writeFileSync(join(app, "delayed-roster.js"), `(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
      const response = await originalFetch(input, init);
      if (path === "/api/worktree/create" && init?.method === "POST") window.worktreeCreated = await response.clone().json();
      return response;
    };
  })();`);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, '<script src="./demo-transport.js"></script><script src="./delayed-roster.js"></script><script type="module"'));
  const server = serveDemo(app, { prefix: "/" });
  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(10_000);
      await page.goto(`http://127.0.0.1:${server.port}/?view=chat`);
      await page.locator(".conn-live").waitFor({ state: "attached" });
      await page.waitForFunction(() => new URLSearchParams(location.search).has("pane"));
      const previousPane = new URL(page.url()).searchParams.get("pane");
      const source = await page.evaluate(async () => {
        const { snapshot } = await (await fetch("/api/session")).json();
        return snapshot.workspaces.find((workspace: { worktree?: { is_linked_worktree?: boolean } }) => workspace.worktree && !workspace.worktree.is_linked_worktree).workspace_id;
      });
      await page.locator(`.workspace-group[data-workspace="${source}"] .workspace-header`).dispatchEvent("contextmenu", { button: 2 });
      await page.getByRole("menuitem", { name: "New worktree", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: /^New worktree/ });
      await dialog.getByLabel(/^Branch/).fill("feat/roster-delay");
      await dialog.locator(".agent-picker-trigger").click();
      await page.locator(".agent-picker-menu").getByText("Oh My Pi", { exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const roster = (window as any).__herdrDemoOrder;
        roster.holdGets(true);
        roster.holdSse(true);
      });
      await dialog.getByRole("button", { name: "Create worktree", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      const created = await page.evaluate(() => (window as any).worktreeCreated);
      assert.ok(created.pane_id);
      assert.equal(new URL(page.url()).searchParams.get("pane"), previousPane);
      await page.evaluate(() => {
        const roster = (window as any).__herdrDemoOrder;
        roster.holdSse(false);
        roster.releaseAllGets();
        roster.publish();
      });
      await page.waitForFunction((id) => new URLSearchParams(location.search).get("ws")?.startsWith(id), created.workspace_id).catch((error: unknown) => { throw new Error("The worktree address did not settle after the roster refreshed", { cause: error }); });
      assert.equal(new URL(page.url()).searchParams.get("pane"), created.pane_id);
      await page.goBack();
      await page.waitForFunction((id) => new URLSearchParams(location.search).get("pane") === id, previousPane);
      await page.goForward();
      await page.waitForFunction((id) => new URLSearchParams(location.search).get("pane") === id, created.pane_id);
      await page.waitForFunction((paneId) =>
        [...document.querySelectorAll("[data-pane-content]")].some((surface) =>
          JSON.parse(surface.getAttribute("data-pane-content") ?? "[]")[1] === paneId),
      created.pane_id);
      assert.equal(await page.locator(".worktree-error").count(), 0);
      console.log("PASS a phone worktree enters browser history once listed and supports Back and Forward");
    } finally { await browser.close(); }
  } finally { server.stop(); }
} finally { rmSync(app, { recursive: true, force: true }); }
