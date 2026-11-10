import { useCallback, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { readLink } from "./deepLink.ts";
import { useGraphRegistry } from "./useGraphRegistry.ts";
import { useGraphRegistryInventory } from "./graphRegistryInventory.ts";

export type GraphPage = "workspace" | "graph";
function locationView(): GraphPage {
  return readLink(window.location.search).page ?? "workspace";
}

/** One App-owned view and inventory. `page` never replaces the terminal's `view` lens. */
export function useGraphPage(enabled: boolean, machines: readonly Machine[]) {
  const [view, updateView] = useState<GraphPage>(locationView);
  const setView = useCallback((next: GraphPage) => updateView(next), []);
  const openGraph = useCallback(() => updateView("graph"), []);
  const graphRegistry = useGraphRegistry(enabled && view === "graph");
  const rows = useGraphRegistryInventory(graphRegistry.registry, machines, graphRegistry.sources);
  return { view, setView, openGraph, rows, ...graphRegistry };
}
