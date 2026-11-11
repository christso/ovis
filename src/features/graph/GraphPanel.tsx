import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { GraphRead, GraphRegistry } from "../../../shared/graph-registry.ts";
import { graphRegistryInventory, type GraphRegistryRow } from "../../../shared/graph-registry-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { useT } from "../../lib/i18n.ts";
import { graphSourceMachines } from "../../lib/graphRegistryInventory.ts";
import { shownTabLabels, subscribeTabLabels } from "../../lib/tabLabels.ts";
import { graphInventory, graphTarget } from "./graphInventory.ts";
import GraphView from "./GraphView.tsx";

export interface GraphPanelProps {
  registry: GraphRegistry | null; rows: readonly GraphRegistryRow[]; machines: readonly Machine[]; sources?: readonly Machine[];
  error: string | null; refresh(): Promise<GraphRead | null>; onOpenTarget(target: PaneTarget): void;
}

export default function GraphPanel({ registry, rows, machines, sources = [], error, refresh, onOpenTarget }: GraphPanelProps) {
  const t = useT();
  const labels = useSyncExternalStore(subscribeTabLabels, shownTabLabels);
  const verifiedMachines = useMemo(() => graphSourceMachines(machines, sources), [machines, sources]);
  const data = useMemo(() => graphInventory(registry, rows, verifiedMachines, labels, t), [registry, rows, verifiedMachines, labels, t]);
  const incomplete = machines.filter((machine) => machine.state !== "connected" || machine.snapshot === null);
  const target = useCallback((id: string) => error ? null : graphTarget(registry, rows, id, verifiedMachines), [error, registry, rows, verifiedMachines]);
  const opening = useRef(0);
  useEffect(() => () => { opening.current++; }, []);
  const openNode = async (id: string) => {
    if (!target(id)) return;
    const ticket = ++opening.current;
    // Selection IDs include the process identity. Re-read its source before opening, so a
    // same-terminal replacement cannot inherit a selection between inventory polls.
    const fresh = await refresh();
    if (!fresh || opening.current !== ticket) return;
    const sources = graphSourceMachines(fresh.sources ?? [], fresh.sources ?? []);
    const current = graphTarget(fresh, graphRegistryInventory(fresh, sources), id, sources);
    if (current) onOpenTarget(current);
  };
  const canOpenNode = useCallback((id: string) => target(id) !== null, [target]);
  return <div className="graph-panel">
    <div className="graph-source-note">
      <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>{t("Refresh")}</button>
      {!registry && !error && <span role="status">{t("Loading work registry…")}</span>}
      {incomplete.length > 0 && <p role="status">{t("Inventory is incomplete for: {machines}.", { machines: incomplete.map((machine) => machine.name).join(", ") })}</p>}
    </div>
    <GraphView data={data} machineNames={new Map(machines.map((machine) => [machine.id, machine.name]))} error={error}
      canOpenNode={canOpenNode} onOpenNode={(id) => void openNode(id)} />
  </div>;
}
