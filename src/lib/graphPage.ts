import { useCallback, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { readLink } from "./deepLink.ts";
import { pageAddress, pageSearch } from "./pageQuery.ts";
import { useGraphRegistry } from "./useGraphRegistry.ts";
import { useGraphRegistryInventory } from "./graphRegistryInventory.ts";

export type GraphPage = "workspace" | "graph";

export function useWorkspaceInbox(enterInbox: () => void, showWorkspace: () => void): () => void {
  return useCallback(() => { showWorkspace(); enterInbox(); }, [showWorkspace, enterInbox]);
}

function locationView(): GraphPage {
  return readLink(window.location.search).page ?? "workspace";
}

/**
 * Until a pane link lands, only the full-page choice is ours to write. Keep its target,
 * foreign query fields and history state intact, including a relay's hash-based address.
 * The caller must first hold writes for any unread popstate.
 */
export function writeGraphPage(page: GraphPage): boolean {
  const search = pageSearch();
  if (page === (readLink(search).page ?? "workspace")) return false;
  const query = new URLSearchParams(search);
  if (page === "workspace") query.delete("page"); else query.set("page", page);
  const next = query.toString();
  window.history.pushState(window.history.state, "", pageAddress(window.location.pathname, next ? `?${next}` : "", window.location.hash));
  return true;
}

/** One App-owned view and inventory. `page` never replaces the terminal's `view` lens. */
export function useGraphPage(enabled: boolean, machines: readonly Machine[]) {
  const [view, updateView] = useState<GraphPage>(locationView);
  const setView = useCallback((next: GraphPage) => updateView(next), []);
  const showWorkspace = useCallback(() => updateView("workspace"), []);
  const openGraph = useCallback(() => updateView("graph"), []);
  const graphRegistry = useGraphRegistry(enabled && view === "graph");
  const rows = useGraphRegistryInventory(graphRegistry.registry, machines, graphRegistry.sources);
  return { view, setView, showWorkspace, openGraph, rows, ...graphRegistry };
}
