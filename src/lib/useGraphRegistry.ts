import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphCommand, GraphRegistry } from "../../shared/graph-registry.ts";
import type { Machine } from "../../shared/machines.ts";
import { ApiError } from "./api.ts";
import { sameData } from "./useMachineRoster.ts";
import { changeGraph, fetchGraph } from "./graphRegistry.ts";

/** App owns one copy for every logical view. Changes are explicit and never auto-retried after conflicts. */
export function useGraphRegistry(enabled: boolean) {
  const [registry, setRegistry] = useState<GraphRegistry | null>(null);
  const [sources, setSources] = useState<Machine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const held = useRef(registry); held.current = registry;
  const request = useRef(0);
  const unreadable = useRef(false);
  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === "flock_unreadable") {
      unreadable.current = true;
      held.current = null;
      setRegistry(null);
    }
    setError(error instanceof Error ? error.message : String(error));
  }, []);
  const take = useCallback((next: GraphRegistry) => {
    setRegistry((before) => before && (before.revision > next.revision || sameData(before, next)) ? before : next);
  }, []);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    try {
      const { sources = [], ...next } = await fetchGraph();
      if (request.current === ticket) { unreadable.current = false; take(next); setSources(Array.isArray(sources) ? sources : []); setError(null); }
    } catch (error) { if (request.current === ticket) { setSources([]); fail(error); } }
  }, [take, fail]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { stopped = true; request.current += 1; window.clearTimeout(timer); };
  }, [enabled, refresh]);
  const change = useCallback(async (command: GraphCommand, revision?: number) => {
    if (!held.current) throw new Error("Work registry is not loaded");
    try { const next = await changeGraph(revision ?? held.current.revision, command); if (!unreadable.current) { take(next); setError(null); } }
    catch (error) { fail(error); throw error; }
  }, [take, fail]);
  return { registry, sources, error, refresh, change };
}
