import { expect, test } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useAddressBar } from "./useAddressBar.ts";

test.each([false, true])("keeps offline Flock navigation in the page query (relay: %s)", async (relay) => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let location = new URL(relay ? "https://app.example/s/fixture/#machine=remote&pane=private-pane" : "https://pc.example/?machine=remote&pane=private-pane");
  const history = { state: { fixture: true }, pushState(_state: unknown, _unused: string, address: string | URL) { location = new URL(address, location); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get location() { return location; }, history, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => relay ? { getAttribute: () => "relay" } : null } });
  const props: Parameters<typeof useAddressBar>[0] = {
    page: "graph", newSessionOpen: false, selectedPane: null, selectedPaneId: null,
    selectedWorkspace: null, viewing: null, selectedMachineId: "remote", leaveFile: () => false,
    restoreFile() {}, fileFromPop: () => 0, forgetLeftFiles() {}, locked: false,
    machines: [], snapshot: null, linkLanded: false, view: "terminal", settingsOpen: false,
    settingsPage: null, settingsLinkPage: null, settingsLinkSection: null, wideScreen: true,
    sidebarCollapsed: false, newTab: null, newFields: null, autoSelected: false,
    pendingFile: { current: null }, selectedMachine: undefined, openFile() {},
    machinesRef: { current: [] }, selectTargetRef: { current() {} }, pendingLink: { current: null },
    setLinkLanded() {}, linkSince: { current: 0 }, rosterSeq: { current: 0 },
    setNewSessionOpen() {}, pendingCreate: { current: null }, setHeaderNote() {},
    selectionRef: { current: { machineId: "remote", paneId: null, generation: 0 } },
  };
  function Harness() { useAddressBar(props); return null; }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(createElement(Harness)); });
    expect(location.search).toBe(relay ? "" : "?machine=remote&pane=private-pane&page=graph");
    expect(location.hash).toBe(relay ? "#machine=remote&pane=private-pane&page=graph" : "");
    props.page = "workspace";
    await act(async () => { renderer!.update(createElement(Harness)); });
    expect(location.search).toBe(relay ? "" : "?machine=remote&pane=private-pane");
    expect(location.hash).toBe(relay ? "#machine=remote&pane=private-pane" : "");
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else Reflect.deleteProperty(globalThis, "window");
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
