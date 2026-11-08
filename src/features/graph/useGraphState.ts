import { useEffect, useState } from "react";
import { DEFAULT_GRAPH_STATE, GRAPH_STORAGE_KEY, graphLocation, readGraphLocation, sanitizeGraphState, type GraphState } from "./graphState.ts";

function loadState(): { state: GraphState; saved: boolean } {
  let state = DEFAULT_GRAPH_STATE;
  let saved = false;
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_STORAGE_KEY) ?? "null");
    const stored = sanitizeGraphState(raw);
    if (stored && raw.layout !== "force") { stored.positions = {}; stored.viewport = DEFAULT_GRAPH_STATE.viewport; }
    if (stored) {
      state = stored;
      saved = Object.keys(stored.positions).length > 0 || stored.viewport.x !== DEFAULT_GRAPH_STATE.viewport.x || stored.viewport.y !== DEFAULT_GRAPH_STATE.viewport.y || stored.viewport.k !== DEFAULT_GRAPH_STATE.viewport.k;
    }
  } catch { /* Storage can be disabled. */ }
  return { state: readGraphLocation(new URL(window.location.href), state), saved };
}

export function useGraphState() {
  const [initial] = useState(loadState);
  const [state, setState] = useState(initial.state);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GRAPH_STORAGE_KEY);
      if (stored !== null && sanitizeGraphState(JSON.parse(stored)) === null) return;
      localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(state));
    } catch { /* The view remains usable without persistence. */ }
  }, [state]);
  const { selected, groupMachine, filters } = state;
  useEffect(() => {
    const url = graphLocation(new URL(window.location.href), { ...DEFAULT_GRAPH_STATE, selected, groupMachine, filters });
    window.history.replaceState(window.history.state, "", url);
  }, [selected, groupMachine, filters]);
  useEffect(() => {
    const popped = () => setState((previous) => readGraphLocation(new URL(window.location.href), previous));
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);
  return [state, setState, initial.saved] as const;
}
