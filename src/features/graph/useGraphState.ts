import { useEffect, useState } from "react";
import { DEFAULT_GRAPH_STATE, GRAPH_STORAGE_KEY, graphLocation, readGraphLocation, sanitizeGraphState, type GraphState } from "./graphState.ts";

function loadState(): GraphState {
  let state = DEFAULT_GRAPH_STATE;
  try { state = sanitizeGraphState(JSON.parse(localStorage.getItem(GRAPH_STORAGE_KEY) ?? "null")) ?? state; } catch { /* Storage can be disabled. */ }
  return readGraphLocation(new URL(window.location.href), state);
}

export function useGraphState() {
  const [state, setState] = useState(loadState);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GRAPH_STORAGE_KEY);
      // Malformed/future data is left intact, rather than replaced with this reader's defaults.
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
  return [state, setState] as const;
}
