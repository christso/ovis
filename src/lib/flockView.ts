import { useCallback, useEffect, useRef, useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { useFlock } from "./useFlock.ts";
import { useFlockInventory } from "./flockInventory.ts";

export type FlockView = "workspace" | "agents" | "table" | "graph";
function locationView(): FlockView {
  const page = new URLSearchParams(window.location.search).get("page");
  return page === "graph" || page === "table" || page === "agents" ? page : "workspace";
}

/** One App-owned view and inventory. `page` never replaces the terminal's `view` lens. */
export function useFlockView(enabled: boolean, machines: readonly Machine[]) {
  const [view, setCurrentView] = useState<FlockView>(locationView);
  const popping = useRef(false);
  const setView = useCallback((next: FlockView, history: "push" | "replace" = "push") => {
    if (popping.current) return;
    setCurrentView(next);
    const url = new URL(window.location.href);
    if (next === locationView()) return;
    if (next === "workspace") url.searchParams.delete("page"); else url.searchParams.set("page", next);
    window.history[history === "push" ? "pushState" : "replaceState"](window.history.state, "", url);
  }, []);
  useEffect(() => {
    const pop = () => {
      popping.current = true; setCurrentView(locationView());
      // App's pane-location listener also selects on this same event; that selection must
      // not replace the explicitly requested Graph/Table page with Workspace.
      queueMicrotask(() => { popping.current = false; });
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const flock = useFlock(enabled && (view === "table" || view === "graph"));
  const rows = useFlockInventory(flock.registry, machines, flock.sources);
  return { view, setView, rows, ...flock };
}
