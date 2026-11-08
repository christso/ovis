import { useT } from "../lib/i18n.ts";
import type { FlockView } from "../lib/flockView.ts";
import "./FlockTable.css";

export function FlockModes({ view, onChange }: { view: Exclude<FlockView, "workspace">; onChange(view: Exclude<FlockView, "workspace">): void }) {
  const t = useT();
  return <div className="flock-header">
    <h1>{t("Flock")}</h1>
    <div className="flock-modes" role="group" aria-label={t("Flock view")}>
      <button type="button" className="btn btn-ghost" aria-pressed={view === "table"} onClick={() => onChange("table")}>{t("Table")}</button>
      <button type="button" className="btn btn-ghost" aria-pressed={view === "graph"} onClick={() => onChange("graph")}>{t("Graph")}</button>
    </div>
  </div>;
}
