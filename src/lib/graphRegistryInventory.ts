import { useMemo, useSyncExternalStore } from "react";
import type { GraphRegistry } from "../../shared/graph-registry.ts";
import type { Machine } from "../../shared/machines.ts";
import { graphRegistryInventory, type GraphRegistryRow } from "../../shared/graph-registry-inventory.ts";
import { graphCliPageValue } from "../../shared/graph-cli.ts";
import { graphCoordinationValue } from "../../shared/graph-relationships.ts";
import { branchRevision, DETACHED, publishedBranch, subscribeBranches } from "./paneBranch.ts";

/** Reuse the sidebar's branch reader; Table and Graph must not start another git inventory. */
export function useGraphRegistryInventory(registry: GraphRegistry | null, machines: readonly Machine[], sources: readonly Machine[] = []): GraphRegistryRow[] {
  const revision = useSyncExternalStore(subscribeBranches, branchRevision);
  return useMemo(() => registry ? graphRegistryInventory(registry, graphSourceMachines(machines, sources)).map((row) => {
    if (row.availability !== "live" || !row.checkout || !row.pane) return row;
    const branch = publishedBranch(row.machine_id, row.pane.workspace_id);
    return branch !== null ? { ...row, checkout: { ...row.checkout, branch: branch === DETACHED ? null : branch } } : row;
  }) : [], [registry, machines, sources, revision]);
}

/** Private evidence is usable only alongside the same connected daemon's current roster. */
export function graphSourceMachines(machines: readonly Machine[], sources: readonly Machine[]): Machine[] {
  return machines.map((machine) => {
    const source = sources.find((item) => item.id === machine.id);
    const matches = machine.state === "connected" && source?.state === "connected" && source.snapshot?.herdr_lifetime
      && source.snapshot.herdr_lifetime === machine.snapshot?.herdr_lifetime;
    const coordination = matches && graphCoordinationValue(source.snapshot?.flock_coordination) ? source.snapshot.flock_coordination : undefined;
    const cli = matches && graphCliPageValue(source.snapshot?.graph_cli) ? source.snapshot.graph_cli : undefined;
    return { ...machine, snapshot: machine.snapshot ? { ...machine.snapshot, flock_bindings: matches ? source.snapshot?.flock_bindings : [], flock_coordination: coordination, graph_cli: cli } : null };
  });
}
