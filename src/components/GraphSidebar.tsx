import { Network } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import "./GraphSidebar.css";

export function GraphSidebar({ active, onOpen }: { active: boolean; onOpen(): void }) {
  const t = useT();
  return <div className="graph-sidebar">
    <button type="button" className="sidebar-section-label" aria-current={active ? "page" : undefined} onClick={onOpen}>
      <span className="sidebar-mark"><Network aria-hidden="true" /></span><span>{t("Graph")}</span>
    </button>
  </div>;
}
