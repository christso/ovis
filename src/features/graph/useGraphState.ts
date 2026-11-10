import { useEffect, useState } from "react";
import { DEFAULT_GRAPH_STATE, graphLocation, loadGraphState, readGraphLocation, saveGraphState, type GraphState } from "./graphState.ts";

function loadState(): { state: GraphState; saved: boolean } {
  let initial = { state: DEFAULT_GRAPH_STATE, saved: false };
  try { initial = loadGraphState(localStorage); } catch { /* Storage can be disabled. */ }
  return { ...initial, state: readGraphLocation(new URL(window.location.href), initial.state) };
}

export function useGraphState() {
  const [initial] = useState(loadState);
  const [state, setState] = useState(initial.state);
  useEffect(() => {
    try { saveGraphState(localStorage, state); } catch { /* The view remains usable without persistence. */ }
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
