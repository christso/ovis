import { Network } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import "./FlockSidebar.css";

export function FlockSidebar({ active, onOpen }: { active: boolean; onOpen(): void }) {
  const t = useT();
  return <div className="flock-sidebar">
    <button type="button" className="sidebar-section-label" aria-current={active ? "page" : undefined} onClick={onOpen}>
      <span className="sidebar-mark"><Network aria-hidden="true" /></span><span>{t("Flock")}</span>
    </button>
  </div>;
}
