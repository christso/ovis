import { useMemo, useSyncExternalStore } from "react";
import type { FlockRegistry } from "../../shared/flock.ts";
import type { Machine } from "../../shared/machines.ts";
import { flockInventory, type FlockRow } from "../../shared/flock-inventory.ts";
import { flockCoordinationValue } from "../../shared/flock-relationships.ts";
import { branchRevision, DETACHED, publishedBranch, subscribeBranches } from "./paneBranch.ts";

/** Reuse the sidebar's branch reader; Table and Graph must not start another git inventory. */
export function useFlockInventory(registry: FlockRegistry | null, machines: readonly Machine[], sources: readonly Machine[] = []): FlockRow[] {
  const revision = useSyncExternalStore(subscribeBranches, branchRevision);
  return useMemo(() => registry ? flockInventory(registry, machines.map((machine) => {
    const source = sources.find((item) => item.id === machine.id);
    const matches = machine.state === "connected" && source?.state === "connected" && source.snapshot?.herdr_lifetime
      && source.snapshot.herdr_lifetime === machine.snapshot?.herdr_lifetime;
    const proofs = matches ? source.snapshot?.flock_bindings : [];
    const coordination = matches && flockCoordinationValue(source.snapshot?.flock_coordination) ? source.snapshot.flock_coordination : undefined;
    return { ...machine, snapshot: machine.snapshot ? { ...machine.snapshot, flock_bindings: proofs, flock_coordination: coordination } : null };
  })).map((row) => {
    if (row.availability !== "live" || !row.checkout || !row.pane) return row;
    const branch = publishedBranch(row.machine_id, row.pane.workspace_id);
    return branch !== null ? { ...row, checkout: { ...row.checkout, branch: branch === DETACHED ? null : branch } } : row;
  }) : [], [registry, machines, sources, revision]);
}
