import { expect, test } from "bun:test";
import { DEFAULT_GRAPH_STATE, GRAPH_STORAGE_KEY, graphLocation, loadGraphState, readGraphLocation, saveGraphState } from "./graphState.ts";
import { DEFAULT_GRAPH_STATE as V2_STATE, GRAPH_STORAGE_KEY as V2_KEY, loadGraphState as loadV2, saveGraphState as saveV2 } from "./graphState.v2-fixture.ts";
import { DEFAULT_GRAPH_STATE as V1_STATE, GRAPH_STORAGE_KEY as V1_KEY } from "./graphState.legacy-fixture.ts";

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test("all three node types start visible in their own versioned store", () => {
  expect(GRAPH_STORAGE_KEY).toBe("ovis:graph:v3");
  expect(DEFAULT_GRAPH_STATE.version).toBe(3);
  expect(DEFAULT_GRAPH_STATE.filters.hiddenKinds).toEqual([]);
  expect(DEFAULT_GRAPH_STATE.legendOpen).toBe(true);
});
test("migrates v2 filters and legend passively, reclusters, and drops retired node selections", () => {
  const old = { ...V2_STATE, selected: "tab:old-occupant", legendOpen: false, groupMachine: true,
    filters: { ...V2_STATE.filters, search: "notes", focus: "pane:old-occupant" },
    positions: { "tab:old-occupant": { x: 9999, y: 9999 } }, viewport: { x: 80, y: 70, k: 0.4 } };
  const bytes = JSON.stringify(old), kinds = JSON.stringify({ version: 1, hiddenKinds: ["worktree", "tab"] });
  const storage = store({ [V2_KEY]: bytes, "ovis:graph:kinds:v1": kinds, "ovis:graph:panes:v1": '{"version":1,"visible":false}' });
  const loaded = loadGraphState(storage);
  expect(loaded).toMatchObject({ saved: false, state: { version: 3, selected: "", groupMachine: true, legendOpen: false,
    filters: { search: "notes", focus: "", hiddenKinds: ["worktree", "terminal"] }, positions: {}, viewport: DEFAULT_GRAPH_STATE.viewport } });
  expect(storage.getItem(GRAPH_STORAGE_KEY)).toBeNull();
  expect(storage.getItem(V2_KEY)).toBe(bytes);
  expect(storage.getItem("ovis:graph:kinds:v1")).toBe(kinds);
  saveGraphState(storage, loaded.state);
  expect(loadV2(storage).state).toMatchObject({ selected: "tab:old-occupant", filters: { hiddenKinds: ["worktree", "tab", "pane"] } });
});
test("old and new pages save independently without erasing preferences or rollback data", () => {
  const storage = store();
  saveV2(storage, { ...V2_STATE, selected: "tab:old", filters: { ...V2_STATE.filters, hiddenKinds: ["workspace"] } });
  const loaded = loadGraphState(storage).state;
  expect(loaded.filters.hiddenKinds).toEqual(["workspace"]);
  saveGraphState(storage, { ...loaded, selected: "terminal:new", legendOpen: false, filters: { ...loaded.filters, hiddenKinds: ["terminal"] }, positions: { "terminal:new": { x: 25, y: 50 } } });
  const newer = storage.getItem(GRAPH_STORAGE_KEY);
  saveV2(storage, { ...loadV2(storage).state, selected: "tab:other", filters: { ...V2_STATE.filters, hiddenKinds: [] } });
  expect(storage.getItem(GRAPH_STORAGE_KEY)).toBe(newer);
  expect(loadGraphState(storage)).toMatchObject({ saved: true, state: { selected: "terminal:new", legendOpen: false, filters: { hiddenKinds: ["terminal"] } } });
  const older = [V2_KEY, "ovis:graph:kinds:v1", "ovis:graph:panes:v1"].map((key) => storage.getItem(key));
  saveGraphState(storage, { ...loadGraphState(storage).state, selected: "terminal:next" });
  expect([V2_KEY, "ovis:graph:kinds:v1", "ovis:graph:panes:v1"].map((key) => storage.getItem(key))).toEqual(older);
  expect(loadV2(storage).state.selected).toBe("tab:other");
});
test("migrates v1 without writing it or retaining its old layout", () => {
  const bytes = JSON.stringify({ ...V1_STATE, selected: "workspace:main", filters: { ...V1_STATE.filters, search: "orchard" } });
  const storage = store({ [V1_KEY]: bytes });
  expect(loadGraphState(storage)).toMatchObject({ saved: false, state: { selected: "workspace:main", filters: { search: "orchard", hiddenKinds: [] }, positions: {} } });
  saveGraphState(storage, loadGraphState(storage).state);
  expect(storage.getItem(V1_KEY)).toBe(bytes);
  expect(storage.getItem(V2_KEY)).toBeNull();
});
test("old pane visibility never hides terminals, while old hidden tabs become hidden terminals", () => {
  for (const visible of [true, false]) {
    const storage = store({ "ovis:graph:panes:v1": JSON.stringify({ version: 1, visible }) });
    expect(loadGraphState(storage).state.filters.hiddenKinds).toEqual([]);
  }
  const storage = store({ "ovis:graph:kinds:v1": '{"version":1,"hiddenKinds":["future","tab","tab","workspace"]}' });
  expect(loadGraphState(storage).state.filters.hiddenKinds).toEqual(["workspace", "terminal"]);
});
test("unknown and damaged v3 records stay intact and never fall back to older stores", () => {
  for (const bytes of ['{"version":99,"future":"keep"}', '{"version":', '{"version":3,"layout":"future"}', '{"version":3,"filters":"garbled"}', '{"version":3,"positions":[]}', '{"version":3,"viewport":null}', '{"version":3,"filters":{"hiddenKinds":"terminal"}}']) {
    const storage = store({ [GRAPH_STORAGE_KEY]: bytes, [V2_KEY]: JSON.stringify({ ...V2_STATE, selected: "old" }) });
    const loaded = loadGraphState(storage);
    expect(loaded.state).toEqual(DEFAULT_GRAPH_STATE);
    saveGraphState(storage, { ...loaded.state, legendOpen: false });
    expect(storage.getItem(GRAPH_STORAGE_KEY)).toBe(bytes);
  }
});
test("valid legacy visibility migrates even when the old layout is unreadable", () => {
  const bytes = '{"version":', kinds = '{"version":1,"hiddenKinds":["worktree","tab"]}';
  const storage = store({ [V2_KEY]: bytes, "ovis:graph:kinds:v1": kinds });
  const loaded = loadGraphState(storage);
  expect(loaded.state.filters.hiddenKinds).toEqual(["worktree", "terminal"]);
  saveGraphState(storage, loaded.state);
  expect(loadGraphState(storage).state.filters.hiddenKinds).toEqual(["worktree", "terminal"]);
  expect(storage.getItem(V2_KEY)).toBe(bytes);
  expect(storage.getItem("ovis:graph:kinds:v1")).toBe(kinds);
});
test("damaged or future legacy stores remain unchanged after a new-client save", () => {
  for (const key of [V2_KEY, V1_KEY, "ovis:graph:kinds:v1", "ovis:graph:panes:v1"]) {
    for (const bytes of ['{"version":99,"future":"keep"}', '{"version":']) {
      const storage = store({ [key]: bytes });
      saveGraphState(storage, loadGraphState(storage).state);
      expect(storage.getItem(key)).toBe(bytes);
    }
  }
});
test("old graph links map hidden tabs to terminals and retire the pane visibility flag", () => {
  const url = new URL("https://ovis.invalid/?graph=1&gk=worktree,tab&gp=1&gn=pane:old&gf=tab:old&pane=w1:p1");
  const state = readGraphLocation(url, DEFAULT_GRAPH_STATE);
  expect(state.filters.hiddenKinds).toEqual(["worktree", "terminal"]);
  expect(state.selected).toBe(""); expect(state.filters.focus).toBe("");
  const next = graphLocation(url, state);
  expect(next.searchParams.get("gk")).toBe("worktree,terminal");
  expect(next.searchParams.has("gp")).toBe(false);
  expect(next.searchParams.get("pane")).toBe("w1:p1");
});
