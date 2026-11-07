import { useCallback, useEffect, useRef, useState } from "react";
import type { FlockCommand, FlockRegistry } from "../../shared/flock.ts";
import { ApiError } from "./api.ts";
import { sameData } from "./useMachineRoster.ts";
import { changeFlock, fetchFlock } from "./flock.ts";

/** App owns one copy for every logical view. Changes are explicit and never auto-retried after conflicts. */
export function useFlock(enabled: boolean) {
  const [registry, setRegistry] = useState<FlockRegistry | null>(null);
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
  const take = useCallback((next: FlockRegistry) => {
    setRegistry((before) => before && (before.revision > next.revision || sameData(before, next)) ? before : next);
  }, []);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    try { const next = await fetchFlock(); if (request.current === ticket) { unreadable.current = false; take(next); setError(null); } }
    catch (error) { if (request.current === ticket) fail(error); }
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
  const change = useCallback(async (command: FlockCommand, revision?: number) => {
    if (!held.current) throw new Error("Work registry is not loaded");
    try { const next = await changeFlock(revision ?? held.current.revision, command); if (!unreadable.current) { take(next); setError(null); } }
    catch (error) { fail(error); throw error; }
  }, [take, fail]);
  return { registry, error, refresh, change };
}
