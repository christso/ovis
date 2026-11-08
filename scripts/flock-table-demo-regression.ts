/** Table behavior on owned fictional PCs, with the real persistent registry handler. No live herdr. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import machinesFixture from "../site/demo/fixtures/machines.json";
import type { Machine } from "../shared/machines.ts";
import { FlockStore, handleFlockRequest } from "../server/flock.ts";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";
import { changeFlockMode, openNativeAgent } from "./flock-navigation.ts";

const root = mkdtempSync(join(tmpdir(), "ovis-flock-browser-"));
const app = join(root, "app");
const machines = structuredClone(machinesFixture.machines) as Machine[];
for (const machine of machines) if (machine.snapshot) {
  machine.snapshot.herdr_lifetime = `flock-fixture-${machine.id}`;
  for (const pane of machine.snapshot.panes) if (pane.agent) pane.agent_session = { agent: pane.agent, kind: "id", source: "fixture", value: `native-${machine.id}-${pane.pane_id}` };
}
const longRepository = "/srv/fixture/projects/commerce-platform-with-a-very-long-repository-name";
const longCheckout = `${longRepository}/worktrees/mobile-table-layout-with-a-long-checkout-name`;
const longBranch = "feat/readable-mobile-executions-with-long-branch-context";
const fixturePane = machines[0]!.snapshot!.panes.find((pane) => pane.agent)!;
fixturePane.agent = "codex";
fixturePane.agent_session = { agent: "codex", kind: "id", source: "fixture", value: "11111111-1111-4111-8111-111111111111" };
machines[0]!.snapshot!.flock_observations = ["delegation", "communication", "communication"].map((kind, index) => ({ id: `fixture-call-${index}`, kind: kind as "delegation" | "communication", source_native_session_id: fixturePane.agent_session!.value, target_native_session_id: "22222222-2222-4222-8222-222222222222", occurred_at: `2026-11-08T00:0${index}:00Z`, source: "codex" }));
for (const fixtureWorkspace of machines[0]!.snapshot!.workspaces) {
fixtureWorkspace.worktree = { checkout_path: longCheckout, repo_root: longRepository, repo_key: "fixture-repo", repo_name: "Fixture commerce", is_linked_worktree: true };
fixtureWorkspace.tokens = { ...fixtureWorkspace.tokens, branch: longBranch };
}
const remote = structuredClone(machines[0]!); remote.id = "fixture-remote"; remote.name = "Fixture remote"; remote.kind = "ssh";
const offline = structuredClone(remote); offline.id = "fixture-offline"; offline.name = "Fixture offline"; offline.state = "disconnected";
for (const machine of [remote, offline]) {
  machine.snapshot!.herdr_lifetime = `flock-fixture-${machine.id}`;
  for (const pane of machine.snapshot!.panes) if (pane.agent) pane.agent_session = { agent: pane.agent, kind: "id", source: "fixture", value: `native-${machine.id}-${pane.pane_id}` };
}
machines.push(remote, offline, { ...offline, id: "fixture-unavailable", name: "Fixture awaiting inventory", state: "connecting", snapshot: null });
const unproven = structuredClone(machines[0]!.snapshot!.panes.find((pane) => pane.agent)!);
unproven.pane_id = "fixture-unproven"; unproven.label = "Unproven fixture"; unproven.agent_session = null;
machines[0]!.snapshot!.panes.push(unproven);
// Explicit fictional ownership proofs stand in for the real native reader in this UI fixture.
for (const machine of machines) if (machine.snapshot) machine.snapshot.flock_bindings = machine.snapshot.panes.flatMap((pane) => pane.agent && pane.agent_session?.kind === "id"
  ? [{ pane_id: pane.pane_id, terminal_id: pane.terminal_id, agent: pane.agent, native_session_id: pane.agent_session.value }] : []);
const rawMachines = structuredClone(machines);
for (const machine of rawMachines) if (machine.snapshot) { delete machine.snapshot.flock_bindings; delete machine.snapshot.flock_observations; }
const chosen = machines[0]!.snapshot!.panes.find((pane) => pane.agent)!;
const evidence = process.env["UI_EVIDENCE_DIR"];
let stateDir = join(root, "state");
let store = new FlockStore(stateDir);
let futureFormat = false;
let server: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
const harness = `<script>(() => {
  const fixture = ${JSON.stringify(rawMachines)};
  const demo = window.fetch;
  const network = window.flockNetwork;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.pathname === '/api/flock') return network(input, init);
    if (url.pathname === '/api/machines') return Response.json({ machines: fixture });
    if (url.pathname === '/api/session') return Response.json({ snapshot: fixture[0].snapshot });
    return demo(input, init);
  };
  const DemoSource = window.EventSource;
  window.EventSource = function(url, options) {
    if (!String(url).includes('/api/machines/events')) return new DemoSource(url, options);
    const source = new EventTarget(); source.readyState = 1; source.close = () => { source.readyState = 2; };
    queueMicrotask(() => source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'machines', machines: fixture }) })));
    return source;
  };
})();</script>`;
try {
  await buildDemoApp(app);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, () => `<script>window.flockNetwork = window.fetch.bind(window);</script><script src="./demo-transport.js"></script>${harness}<script type="module"`));
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/flock") {
      if (futureFormat && request.method === "GET") return Response.json({ version: 2, revision: 100 });
      return handleFlockRequest(request, store, rawMachines, async (id) => machines.filter((machine) => machine.id === id));
    }
    if (!path.startsWith("/herdr-web-ui/demo/app/")) return new Response("not found", { status: 404 });
    const file = decodeURIComponent(path.slice("/herdr-web-ui/demo/app/".length)) || "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return await body.exists() ? new Response(body) : new Response("not found", { status: 404 });
  } });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  for (const { width, height, theme } of [1280, 390, 320].flatMap((width) => (["dark", "light"] as const).map((theme) => ({ width, height: width === 320 ? 568 : 844, theme })))) {
    stateDir = join(root, `state-${width}-${theme}`); store = new FlockStore(stateDir); futureFormat = false;
    const context = await browser.newContext({ viewport: { width, height }, locale: "en-US", ...(width < 640 ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript((theme) => { localStorage.setItem("ovis:settings", JSON.stringify({ language: "en", theme })); }, theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/?pane=${encodeURIComponent(chosen.pane_id)}`);
      const openTable = () => changeFlockMode(page, "Table");
      await openTable();
      const table = page.getByRole("region", { name: "Table", exact: true });
      await table.locator(".flock-open:enabled").first().waitFor();
      const filters = table.getByRole("button", { name: /^Filters and sort/ });
      if (width < 640) {
        assert.equal(await filters.getAttribute("aria-expanded"), "false");
        const first = await table.locator("tr[data-row-id]").first().boundingBox();
        assert.ok(first && first.y >= 0 && first.y + first.height <= height, "first useful card is fully visible without scrolling");
        await filters.tap();
        assert.equal(await filters.getAttribute("aria-expanded"), "true");
      }
      await table.getByText(/Inventory is incomplete for:.*Fixture awaiting inventory/).waitFor();
      const before = new URL(page.url()).searchParams.get("pane");
      await openNativeAgent(page, "local", chosen.pane_id);
      await page.waitForURL((url) => !url.searchParams.has("page"));
      assert.equal(new URL(page.url()).searchParams.get("pane"), before, "view switches preserve terminal selection");
      await openTable();
      if (width < 640) await filters.tap();
      await table.getByRole("button", { name: "New work", exact: true }).click();
      let form = table.getByRole("form", { name: "Session association" });
      await form.getByLabel("Name", { exact: true }).fill("Release work");
      await form.getByRole("button", { name: "Save association" }).click();
      await form.waitFor({ state: "hidden" });
      const work = store.read().works[0]!;
      await table.getByRole("combobox", { name: "Machine", exact: true }).selectOption("local");
      const firstRow = table.locator("tbody tr").filter({ has: page.getByRole("button", { name: chosen.label!, exact: true }) });
      await firstRow.getByRole("button", { name: "Associate session", exact: true }).click();
      form = table.getByRole("form", { name: "Session association" });
      await form.getByLabel("Name", { exact: true }).fill("Table fixture session");
      await form.getByLabel("Work", { exact: true }).selectOption(work.id);
      await form.getByRole("button", { name: "Save association" }).click();
      await form.waitFor({ state: "hidden" });
      const session = store.read().sessions[0]!;
      const execution = store.read().executions[0]!;
      const registered = table.locator(`tr[data-row-id="${execution.id}"]`);
      await registered.locator("summary").click();
      await registered.getByText("Observed relationships", { exact: true }).waitFor();
      assert.equal(await registered.getByText("Codex 22222222", { exact: true }).count(), 2, "Table shows the same directed observed relationships as Graph");
      await registered.getByText("2 recorded events").waitFor();
      await registered.locator("summary").click();
      await registered.getByRole("button", { name: "Edit association" }).click();
      form = table.getByRole("form", { name: "Session association" });
      await form.getByLabel("Name", { exact: true }).fill("Renamed fixture");
      await form.getByRole("button", { name: "Save association" }).click();
      await form.waitFor({ state: "hidden" });
      assert.equal(store.read().sessions[0]!.id, session.id);
      assert.equal(store.read().sessions[0]!.name, "Renamed fixture");
      // Another browser edits while this editor stays open; a poll/refresh must not upgrade its write revision.
      await registered.getByRole("button", { name: "Edit association" }).click();
      store.change(store.read().revision, { type: "rename-session", id: session.id, name: "Other browser edit", work_id: work.id }, machines);
      await table.getByRole("button", { name: "Refresh", exact: true }).click();
      await registered.getByRole("button", { name: "Other browser edit", exact: true }).waitFor();
      form = table.getByRole("form", { name: "Session association" });
      await form.getByRole("button", { name: "Save association" }).click();
      await form.getByText("The registry changed. Cancel and reopen this form to review current values.").waitFor();
      assert.equal(store.read().sessions[0]!.name, "Other browser edit");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await registered.getByRole("button", { name: "Edit association" }).click();
      await form.getByLabel("Name", { exact: true }).fill("Renamed fixture");
      await form.getByRole("button", { name: "Save association" }).click();
      await form.waitFor({ state: "hidden" });
      // A distinct machine intentionally reuses pane IDs. Associate one execution explicitly with the same logical session.
      await table.getByRole("combobox", { name: "Machine", exact: true }).selectOption(remote.id);
      await table.locator("tbody tr").filter({ has: page.getByRole("button", { name: chosen.label!, exact: true }) }).getByRole("button", { name: "Associate session", exact: true }).click();
      form = table.getByRole("form", { name: "Session association" });
      await form.getByRole("combobox", { name: "Logical session", exact: true }).selectOption(session.id);
      await form.getByRole("button", { name: "Save association" }).click();
      await form.waitFor({ state: "hidden" });
      assert.equal(store.read().sessions.length, 1);
      assert.equal(store.read().executions.length, 2);
      assert.equal(store.read().executions[1]!.machine_id, remote.id);
      assert.equal(store.read().sessions[0]!.work_id, work.id);
      await table.getByRole("combobox", { name: "Machine", exact: true }).selectOption("");
      await table.getByLabel("Filter sessions").fill("Renamed Release");
      assert.equal(await table.locator("tbody tr").count(), 2);
      await table.getByLabel("Filter sessions").fill("no-such-session-fixture");
      await table.getByText("No sessions match", { exact: true }).waitFor();
      await table.getByLabel("Filter sessions").fill("");
      await table.getByLabel("Group by machine").check();
      assert.ok(await table.locator(".flock-group").count() > 0);
      await table.getByLabel("Group by machine").uncheck();
      if (width < 640) {
        const sort = table.getByRole("combobox", { name: "Sort by", exact: true });
        for (const value of ["work", "repository", "branch", "status", "machine", "name"]) await sort.selectOption(value);
        await table.getByRole("button", { name: "Ascending", exact: false }).tap();
        assert.equal(await table.getByRole("button", { name: "Descending", exact: false }).getAttribute("aria-pressed"), "true");
        await filters.tap();
        assert.equal(await filters.textContent(), "Filters and sort (1)");
        assert.equal(await table.getByRole("combobox", { name: "Machine", exact: true }).isVisible(), false);
        await filters.tap();
        assert.equal(await sort.inputValue(), "name", "disclosure retains sorting state");
        await filters.tap();
      } else {
        await table.getByRole("columnheader", { name: /^Name/ }).getByRole("button").click();
        assert.equal(await table.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort"), "descending");
      }
      const unavailable = table.locator("tbody tr").filter({ hasText: "Disconnected" });
      assert.ok(await unavailable.count() > 0);
      assert.equal(await unavailable.first().locator(".flock-open").isEnabled(), false);
      const unsupported = table.locator("tbody tr").filter({ hasText: "Unproven fixture" });
      assert.equal(await unsupported.locator(".flock-open").isEnabled(), false);
      assert.equal(await unsupported.getByRole("button", { name: "Associate session" }).isEnabled(), false);
      if (evidence) {
        mkdirSync(join(evidence, "flock-table"), { recursive: true });
        await page.screenshot({ path: join(evidence, "flock-table", `table-${width}-${theme}.png`) });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "table scroll stays inside its own region");
      await registered.locator(".flock-open").click();
      await page.waitForURL((url) => !url.searchParams.has("page"));
      await page.waitForURL((url) => url.searchParams.get("pane") === execution.pane_id);
      if (execution.machine_id !== "local") assert.equal(new URL(page.url()).searchParams.get("machine"), execution.machine_id);
      await openTable();
      assert.equal(await table.locator(`tr[data-row-id="${execution.id}"] .flock-open`).getAttribute("aria-current"), "true");
      const remoteExecution = store.read().executions[1]!;
      assert.equal(remoteExecution.pane_id, execution.pane_id, "fixture reuses a pane ID across machines");
      await table.locator(`tr[data-row-id="${remoteExecution.id}"] .flock-open`).click();
      await page.waitForURL((url) => url.searchParams.get("machine") === remote.id && url.searchParams.get("pane") === remoteExecution.pane_id);
      await page.waitForURL((url) => !url.searchParams.has("page"));
      store = new FlockStore(stateDir);
      await page.reload();
      await openTable();
      await page.locator(`tr[data-row-id="${execution.id}"]`).getByRole("button", { name: "Renamed fixture", exact: true }).waitFor();
      assert.equal(store.read().sessions[0]!.id, session.id);
      await page.locator(`tr[data-row-id="${execution.id}"]`).getByRole("button", { name: "Edit association" }).click();
      futureFormat = true;
      await table.getByRole("button", { name: "Refresh", exact: true }).click();
      await table.getByRole("alert").filter({ hasText: "format cannot be read" }).waitFor();
      assert.equal(await table.getByRole("button", { name: "Save association" }).isEnabled(), false);
      if (width < 640) await filters.tap();
      assert.equal(await table.getByRole("button", { name: "New work", exact: true }).isEnabled(), false);
      if (width < 640) await filters.tap();
      assert.equal(store.read().sessions[0]!.id, session.id);
      futureFormat = false;
      await table.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.locator(`tr[data-row-id="${execution.id}"]`).getByRole("button", { name: "Renamed fixture", exact: true }).waitFor();
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      const longName = "Investigate checkout reconciliation across machines with a deliberately long fixture session name";
      store.change(store.read().revision, { type: "rename-session", id: session.id, name: longName, work_id: work.id }, machines);
      store.change(store.read().revision, { type: "rename-work", id: work.id, name: "Release work with a deliberately long customer-facing delivery name" }, machines);
      await table.getByRole("button", { name: "Refresh", exact: true }).click();
      await registered.getByRole("button", { name: longName, exact: true }).waitFor();
      await table.getByLabel("Filter sessions").fill("reconciliation");
      if (width < 640) {
        for (const phoneHeight of [568, 844]) {
          await page.setViewportSize({ width, height: phoneHeight });
          await table.evaluate((element) => { element.scrollTop = 0; });
          const row = table.locator("tr[data-row-id]").first();
          const geometry = await row.boundingBox();
          assert.ok(geometry && geometry.y + geometry.height <= phoneHeight, "long-name card and actions fit in initial viewport");
          assert.equal(await row.locator(".flock-work").isVisible(), true);
          assert.equal(await row.locator(".flock-machine").isVisible(), true);
          assert.equal(await row.locator(".flock-checkout-name").textContent(), longCheckout.split("/").at(-1)!);
          assert.equal(await row.locator(".flock-status").isVisible(), true);
          assert.ok(await table.evaluate((element) => element.scrollWidth <= element.clientWidth), "no Table horizontal scroll");
          assert.ok(await table.locator(".flock-scroll").evaluate((element) => element.scrollWidth <= element.clientWidth), "no card horizontal scroll");
          const controls = row.locator("button, summary");
          for (const control of await controls.all()) {
            const box = await control.boundingBox();
            assert.ok(box && box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= width, "row control is reachable and touch-sized");
          }
          const summary = row.locator("summary");
          await summary.tap();
          assert.equal(await row.locator("details").getAttribute("open"), "");
          for (const value of [longName, longRepository, longCheckout, longBranch, session.id]) assert.ok((await row.locator("dl").textContent())!.includes(value), `full metadata disclosed: ${value}`);
          // fixed wait: the native touch highlight fades before retained visual evidence.
          if (evidence) await page.waitForTimeout(400);
          if (evidence) await page.screenshot({ path: join(evidence, "flock-table", `details-${width}-${phoneHeight}-${theme}.png`) });
          await summary.tap();
          assert.equal(await row.locator("details").getAttribute("open"), null);
          await table.evaluate((element) => { element.scrollTop = 0; });
          // fixed wait: the native touch highlight fades before retained visual evidence.
          if (evidence) await page.waitForTimeout(400);
          if (evidence) await page.screenshot({ path: join(evidence, "flock-table", `cards-${width}-${phoneHeight}-${theme}.png`) });
        }
      } else {
        assert.equal(await table.locator("thead").isVisible(), true);
        if (evidence) await page.screenshot({ path: join(evidence, "flock-table", `long-desktop-${theme}.png`) });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page horizontal overflow with long fixture metadata");
      assert.deepEqual(errors, []);
      console.log(`PASS Table ${width} ${theme}: explicit adoption, rename, persistence, filter, grouping, sort and terminal selection`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close(); server?.stop(true); rmSync(root, { recursive: true, force: true });
}
