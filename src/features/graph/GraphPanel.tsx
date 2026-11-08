import { useMemo, useSyncExternalStore } from "react";
import type { FlockRegistry } from "../../../shared/flock.ts";
import type { FlockRow } from "../../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../../shared/machines.ts";
import { useT } from "../../lib/i18n.ts";
import { shownTabLabels, subscribeTabLabels } from "../../lib/tabLabels.ts";
import { graphInventory, graphTarget } from "./graphInventory.ts";
import GraphView from "./GraphView.tsx";

export interface GraphPanelProps {
  registry: FlockRegistry | null; rows: readonly FlockRow[]; machines: readonly Machine[];
  error: string | null; refresh(): Promise<void>; onOpenTarget(target: PaneTarget): void;
}

export default function GraphPanel({ registry, rows, machines, error, refresh, onOpenTarget }: GraphPanelProps) {
  const t = useT();
  const labels = useSyncExternalStore(subscribeTabLabels, shownTabLabels);
  const data = useMemo(() => graphInventory(registry, rows, machines, labels, t), [registry, rows, machines, labels, t]);
  const incomplete = machines.filter((machine) => machine.state !== "connected" || machine.snapshot === null);
  const target = (id: string) => error ? null : graphTarget(registry, rows, id);
  return <div className="graph-panel">
    <div className="graph-source-note">
      <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>{t("Refresh")}</button>
      {!registry && !error && <span role="status">{t("Loading work registry…")}</span>}
      {incomplete.length > 0 && <p role="status">{t("Inventory is incomplete for: {machines}.", { machines: incomplete.map((machine) => machine.name).join(", ") })}</p>}
    </div>
    <GraphView data={data} machineNames={new Map(machines.map((machine) => [machine.id, machine.name]))} error={error}
      canOpenNode={(id) => target(id) !== null} onOpenNode={(id) => { const current = target(id); if (current) onOpenTarget(current); }} />
  </div>;
}
