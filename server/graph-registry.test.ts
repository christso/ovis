import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Machine } from "../shared/machines.ts";
import { graphRegistryInventory, graphRowTarget } from "../shared/graph-registry-inventory.ts";
import { GraphRegistryStore } from "./graph-registry.ts";

const roots: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "ovis-graph-")); roots.push(dir); return dir; }
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const machine = (id = "local", lifetime = "herdr-1", native = "native-1"): Machine => ({ id, name: id, kind: "local", enabled: true, state: "connected", error: null,
  snapshot: { agents: [], layouts: [], protocol: 1, version: "fixture", focused_workspace_id: "w1", focused_pane_id: "w1:p1", workspaces: [], tabs: [], panes: [{ pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", terminal_id: "t1", revision: 0, focused: true, agent: "codex", agent_status: "working", cwd: "/fixture/repo", agent_session: { agent: "codex", kind: "id", source: "fixture", value: native } }], herdr_lifetime: lifetime,
    flock_bindings: [{ pane_id: "w1:p1", terminal_id: "t1", agent: "codex", native_session_id: native }] } });
const binding = (id = "local") => ({ machine_id: id, pane_id: "w1:p1", herdr_lifetime: "herdr-1", agent: "codex", native_session_id: "native-1" });

it("keeps a bare Herdr native-session hint visible but cannot adopt or target it", () => {
  const source = machine();
  delete source.snapshot!.flock_bindings;
  const store = new GraphRegistryStore(root());
  const [row] = graphRegistryInventory(store.read(), [source]);
  expect(row!.availability).toBe("unsupported");
  expect(graphRowTarget(row!)).toBeNull();
  expect(() => store.change(0, { type: "adopt", name: "Wrong pane's thread", binding: binding() }, [source])).toThrow();
  expect(store.read().revision).toBe(0);
});

it("uses verified ownership when the reported hint names another pane's thread, and rejects a recycled terminal", () => {
  const source = machine();
  source.snapshot!.panes[0]!.agent_session!.value = "another-panes-thread";
  const store = new GraphRegistryStore(root());
  const doc = store.change(0, { type: "adopt", name: "Proven session", binding: binding() }, [source]);
  expect(doc.executions[0]!.native_session_id).toBe("native-1");
  source.snapshot!.panes[0]!.terminal_id = "replacement-terminal";
  expect(graphRowTarget(graphRegistryInventory(doc, [source])[0]!)).toBeNull();
});

it("keeps explicit identities through renames, restart, duplicate names and subsequent executions", () => {
  const dir = root(); const store = new GraphRegistryStore(dir);
  let doc = store.change(0, { type: "create-work", name: "Same name" }, []);
  doc = store.change(doc.revision, { type: "adopt", name: "Same name", work_id: doc.works[0]!.id, binding: binding() }, [machine()]);
  const session = doc.sessions[0]!; const execution = doc.executions[0]!;
  doc = store.change(doc.revision, { type: "rename-session", id: session.id, name: "Renamed", work_id: session.work_id }, []);
  doc = store.change(doc.revision, { type: "adopt", name: "Renamed", binding: binding("second") }, [machine("second")]);
  expect(doc.sessions).toHaveLength(2);
  doc = store.change(doc.revision, { type: "adopt", session_id: session.id, expected_execution_id: execution.id, binding: binding("third") }, [machine("third")]);
  expect(doc.sessions[0]).toMatchObject({ id: session.id, name: "Renamed", work_id: session.work_id, current_execution_id: doc.executions[2]!.id });
  expect(doc.executions[0]).toEqual(execution);
  expect(new GraphRegistryStore(dir).read()).toEqual(doc);
  expect(() => store.change(doc.revision, { type: "adopt", session_id: session.id, expected_execution_id: execution.id, binding: binding("fourth") }, [machine("fourth")])).toThrow("changed");
});

it("refuses stale writes, stale lifetime/native session and duplicate binding adoption", () => {
  const store = new GraphRegistryStore(root());
  expect(() => store.change(0, { type: "adopt", name: "Work", binding: binding() }, [machine("local", "herdr-2")])).toThrow();
  expect(() => store.change(0, { type: "adopt", name: "Work", binding: binding() }, [machine("local", "herdr-1", "different")])).toThrow();
  const doc = store.change(0, { type: "adopt", name: "Work", binding: binding() }, [machine()]);
  expect(() => store.change(0, { type: "create-work", name: "Lost update" }, [])).toThrow();
  expect(() => store.change(doc.revision, { type: "adopt", name: "Duplicate", binding: binding() }, [machine()])).toThrow();
  expect(store.read()).toEqual(doc);
});

it("preserves unknown or malformed stored data and refuses overwriting it, including replacement after load", () => {
  const dir = root(); const store = new GraphRegistryStore(dir);
  for (const bytes of ['{"version":2}', '{"version":1,"revision":0,"works":[]}', 'not json']) {
    writeFileSync(join(dir, "flock.json"), bytes);
    expect(() => store.read()).toThrow();
    expect(() => store.change(0, { type: "create-work", name: "Oops" }, [])).toThrow();
    expect(readFileSync(join(dir, "flock.json"), "utf8")).toBe(bytes);
  }
});

it("never targets recycled panes or disconnected sources and retains distinct executions", () => {
  const store = new GraphRegistryStore(root());
  const doc = store.change(0, { type: "adopt", name: "Work", binding: binding() }, [machine()]);
  expect(graphRowTarget(graphRegistryInventory(doc, [machine()])[0]!)).toEqual({ machine_id: "local", pane_id: "w1:p1" });
  const recycled = graphRegistryInventory(doc, [machine("local", "herdr-2")]);
  expect(recycled).toHaveLength(2);
  expect(graphRowTarget(recycled[0]!)).toBeNull();
  const offline = machine(); offline.state = "disconnected";
  expect(graphRegistryInventory(doc, [offline])[0]!.availability).toBe("disconnected");
  expect(graphRowTarget(graphRegistryInventory(doc, [offline])[0]!)).toBeNull();
  expect(graphRowTarget(graphRegistryInventory(doc, [machine("local", "herdr-1", "other")])[0]!)).toBeNull();
  expect(graphRegistryInventory(doc, [])[0]!.availability).toBe("unavailable");
});

it("refuses source metadata that would make the persisted registry unreadable, keeping previous bytes", () => {
  const dir = root(); const store = new GraphRegistryStore(dir);
  store.change(0, { type: "create-work", name: "Keep this" }, []);
  const bytes = readFileSync(join(dir, "flock.json"), "utf8");
  const source = machine(); source.snapshot!.panes[0]!.tokens = { branch: "x".repeat(4097) };
  expect(() => store.change(1, { type: "adopt", name: "Invalid source", binding: binding() }, [source])).toThrow();
  expect(readFileSync(join(dir, "flock.json"), "utf8")).toBe(bytes);
  expect(store.read().works[0]!.name).toBe("Keep this");
});
