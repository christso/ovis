import { createContext, useCallback, useRef, type RefObject } from "react";
import type { Machine } from "../../shared/machines.ts";
import { findMessageSource, messageSourceMachineKey } from "./messageSources.ts";
import { resolveMessageSource } from "./api.ts";

/** A browser selection only: the receiving PC owns lookup; every destination supplies fresh proof. */
export const MessageSourceContext = createContext<((receiver: string, id: string) => Promise<boolean>) | null>(null);

export function useMessageSourceNavigation({ machines, picks, select, refresh }: {
  machines: RefObject<Machine[]>;
  picks: RefObject<number>;
  select: RefObject<(machine: string, pane: string | null, view?: "terminal" | "chat") => void>;
  refresh: () => Promise<unknown>;
}) {
  const requests = useRef(0);
  return useCallback(async (receiver: string, id: string): Promise<boolean> => {
    const request = ++requests.current, at = picks.current, before = machines.current;
    const currentRequest = () => request === requests.current && picks.current === at;
    try {
      const target = await findMessageSource(id, receiver, before);
      if (!target || !currentRequest()) return false;
      await refresh();
      const final = await resolveMessageSource(target.source, target.machine_id);
      if (final.pane_id !== target.pane_id) return false;
      const current = machines.current;
      for (const machineId of [receiver, target.machine_id]) {
        const previous = before.find((machine) => machine.id === machineId), latest = current.find((machine) => machine.id === machineId);
        if (!previous || !latest || !latest.enabled || latest.state !== "connected" || messageSourceMachineKey(previous) !== messageSourceMachineKey(latest)) return false;
      }
      if (!currentRequest()) return false;
      select.current(target.machine_id, target.pane_id, "terminal");
      return true;
    } catch { return false; }
  }, [machines, picks, select, refresh]);
}
