import { useState } from "react";
import type { Machine } from "../../shared/machines.ts";
import { useFlock } from "./useFlock.ts";
import { useFlockInventory } from "./flockInventory.ts";

export type FlockView = "workspace" | "agents" | "table";

/** One App-owned view and inventory, shared by every logical presentation. */
export function useFlockView(enabled: boolean, machines: readonly Machine[]) {
  const [view, setView] = useState<FlockView>("workspace");
  const flock = useFlock(enabled && view === "table");
  const rows = useFlockInventory(flock.registry, machines);
  return { view, setView, rows, ...flock };
}
