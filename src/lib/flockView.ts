import { useCallback, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { readLink } from "./deepLink.ts";
import { useFlock } from "./useFlock.ts";
import { useFlockInventory } from "./flockInventory.ts";

export type FlockView = "workspace" | "graph";
function locationView(): FlockView {
  return readLink(window.location.search).page ?? "workspace";
}

/** One App-owned view and inventory. `page` never replaces the terminal's `view` lens. */
export function useFlockView(enabled: boolean, machines: readonly Machine[]) {
  const [view, updateView] = useState<FlockView>(locationView);
  const setView = useCallback((next: FlockView) => updateView(next), []);
  const openFlock = useCallback(() => updateView("graph"), []);
  const flock = useFlock(enabled && view === "graph");
  const rows = useFlockInventory(flock.registry, machines, flock.sources);
  return { view, setView, openFlock, rows, ...flock };
}
