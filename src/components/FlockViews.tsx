import { useT } from "../lib/i18n.ts";
import "./FlockTable.css";

import type { FlockView } from "../lib/flockView.ts";
export type { FlockView } from "../lib/flockView.ts";
/** Changing this view never changes the selected terminal target. Graph extends this one selector. */
export function FlockViews({ view, onChange }: { view: FlockView; onChange(view: FlockView): void }) {
  const t = useT();
  return <nav className="flock-views" aria-label={t("Views")}>
    <button type="button" className="btn btn-ghost" aria-current={view === "workspace" ? "page" : undefined} onClick={() => onChange("workspace")}>{t("Workspace")}</button>
    <button type="button" className="btn btn-ghost" aria-current={view === "agents" ? "page" : undefined} onClick={() => onChange("agents")}>{t("Agents")}</button>
    <button type="button" className="btn btn-ghost" aria-current={view === "table" ? "page" : undefined} onClick={() => onChange("table")}>{t("Table")}</button>
    <button type="button" className="btn btn-ghost" aria-current={view === "graph" ? "page" : undefined} onClick={() => onChange("graph")}>{t("Graph")}</button>
  </nav>;
}
