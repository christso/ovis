import { expect, test } from "bun:test";
import { DEFAULT_GRAPH_STATE, GRAPH_STORAGE_KEY, loadGraphState, saveGraphState } from "./graphState.ts";
import { DEFAULT_GRAPH_STATE as LEGACY_STATE, GRAPH_STORAGE_KEY as LEGACY_KEY, sanitizeGraphState as readLegacy } from "./graphState.legacy-fixture.ts";

test("the clustered layout and legend preference use their own versioned store", () => {
  expect(GRAPH_STORAGE_KEY).toBe("ovis:graph:v2");
  expect(DEFAULT_GRAPH_STATE.version).toBe(2);
  expect(DEFAULT_GRAPH_STATE.legendOpen).toBe(true);
});

function store(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test("migrates v1 selections and filters once, reclusters, and leaves rollback bytes intact", () => {
  const legacy = { ...LEGACY_STATE, selected: "tab-one", groupMachine: true, filters: { ...LEGACY_STATE.filters, search: "notes" }, positions: { "tab-one": { x: 9999, y: 9999 } }, viewport: { x: 80, y: 70, k: 0.4 } };
  const bytes = JSON.stringify(legacy), storage = store({ [LEGACY_KEY]: bytes });
  const loaded = loadGraphState(storage);
  expect(loaded.saved).toBe(false);
  expect(loaded.state).toMatchObject({ version: 2, selected: "tab-one", groupMachine: true, legendOpen: true, filters: { search: "notes" }, positions: {}, viewport: DEFAULT_GRAPH_STATE.viewport });
  expect(storage.getItem(GRAPH_STORAGE_KEY)).toBeNull();
  saveGraphState(storage, { ...loaded.state, legendOpen: false, positions: { "tab-one": { x: 25, y: 50 } } });
  expect(storage.getItem(LEGACY_KEY)).toBe(bytes);
  expect(readLegacy(JSON.parse(storage.getItem(LEGACY_KEY)!))).toEqual(legacy);
  expect(loadGraphState(storage)).toMatchObject({ saved: true, state: { legendOpen: false, positions: { "tab-one": { x: 25, y: 50 } } } });
});
test("an old tab's unrelated save cannot erase the new layout or legend preference", () => {
  const storage = store({ [LEGACY_KEY]: JSON.stringify(LEGACY_STATE) });
  saveGraphState(storage, { ...DEFAULT_GRAPH_STATE, legendOpen: false });
  const newer = storage.getItem(GRAPH_STORAGE_KEY);
  const old = readLegacy(JSON.parse(storage.getItem(LEGACY_KEY)!))!;
  storage.setItem(LEGACY_KEY, JSON.stringify({ ...old, selected: "old-tab-selection" }));
  expect(storage.getItem(GRAPH_STORAGE_KEY)).toBe(newer);
  expect(loadGraphState(storage).state).toMatchObject({ selected: "", legendOpen: false });
  saveGraphState(storage, { ...loadGraphState(storage).state, selected: "new-selection" });
  expect(readLegacy(JSON.parse(storage.getItem(LEGACY_KEY)!))!.selected).toBe("old-tab-selection");
});
test("unknown and damaged v2 records stay byte-for-byte intact, even with valid v1 data", () => {
  for (const bytes of ['{"version":99,"future":"keep"}', '{"version":', '{"version":2,"layout":"future"}']) {
    const legacy = JSON.stringify(LEGACY_STATE), storage = store({ [GRAPH_STORAGE_KEY]: bytes, [LEGACY_KEY]: legacy });
    const loaded = loadGraphState(storage);
    saveGraphState(storage, { ...loaded.state, legendOpen: false });
    expect(storage.getItem(GRAPH_STORAGE_KEY)).toBe(bytes);
    expect(storage.getItem(LEGACY_KEY)).toBe(legacy);
  }
});
