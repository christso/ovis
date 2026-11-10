import { lazy, Suspense } from "react";
import type { HealthAuth } from "../../../shared/protocol.ts";
import { useT } from "../../lib/i18n.ts";
import type { GraphPanelProps } from "./GraphPanel.tsx";

const GraphPanel = lazy(() => import("./GraphPanel.tsx"));

export function GraphEntry({ auth, ...props }: GraphPanelProps & { auth: HealthAuth | null }) {
  const t = useT();
  if (auth === null) return <p role="status">{t("Opening…")}</p>;
  if (auth.role === "watch") return <p className="graph-note">{t("This device can only watch")}</p>;
  return <Suspense fallback={<p role="status">{t("Opening…")}</p>}><GraphPanel {...props} /></Suspense>;
}
