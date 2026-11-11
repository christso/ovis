import { useEffect, useRef, useState } from "react";
import { Network } from "lucide-react";
import type { CommunicationTrackingStatus } from "../../shared/communication-tracking.ts";
import { ApiError, fetchCommunicationTracking, setCommunicationTracking } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { userErrorMessage } from "../lib/userError.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { SettingsGroup, SettingsRow } from "./SettingsControls.tsx";

/** Keyed by PC in AgentsSettings: an in-flight setup always retains the PC it was approved for. */
export function CommunicationTrackingSettings() {
  const machineId = useMachineId();
  const t = useT();
  const [status, setStatus] = useState<CommunicationTrackingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const [confirm, setConfirm] = useState<"enable" | "disable" | null>(null);
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    setError(null);
    void fetchCommunicationTracking(machineId, abort.signal).then((answer) => { if (!abort.signal.aborted) setStatus(answer); }, (cause: unknown) => {
      if (!abort.signal.aborted) setError(cause instanceof ApiError && cause.status === 404
        ? t("Update Ovis on this PC to set up communication tracking.") : userErrorMessage(cause).message);
    });
    return () => abort.abort();
  }, [machineId, reads, t]);
  const enabled = status?.state === "enabled";
  const attention = status?.state === "needs_attention";
  const available = status !== null && status.state !== "unsupported" && status.can_manage;
  const condition = error ?? (status === null ? t("Loading…")
    : enabled ? t("Enabled for new Herdr terminals. Relaunch existing agents to use it.")
      : attention ? t("Setup needs attention. Check the details below, then retry or disable tracking.")
        : status.state === "unsupported" ? t("Communication tracking setup is unavailable on this PC.")
          : t("Show links when agents start or message other agents through Herdr."));
  return <SettingsGroup section="communication-tracking">
    <SettingsRow icon={Network} label={t("Communication tracking")} wide held={confirm !== null}
      description={t("Show links when agents start or message other agents through Herdr.")}
      condition={<>
        <span role={error ? "alert" : "status"}>{condition}</span>
        {status?.detail && <span className="settings-hint">{status.detail}</span>}
        {status && !status.can_manage && <span className="settings-hint">{t("Only the owner can change communication tracking on this PC.")}</span>}
      </>}>
      {available && <button ref={action} className="btn" type="button" aria-label={enabled ? t("Disable communication tracking") : t("Enable communication tracking")} onClick={() => setConfirm(enabled ? "disable" : "enable")}>
        {enabled ? t("Disable") : attention ? t("Retry") : t("Enable")}
      </button>}
      {available && attention && <button className="btn btn-ghost" type="button" aria-label={t("Disable communication tracking")} onClick={() => setConfirm("disable")}>{t("Disable")}</button>}
      <button className="btn btn-ghost" type="button" aria-label={t("Check communication tracking")} onClick={() => setReads((value) => value + 1)} disabled={confirm !== null}>{t("Check again")}</button>
    </SettingsRow>
    {confirm !== null && status !== null && <ConfirmDialog title={confirm === "enable" ? t("Enable communication tracking?") : t("Disable communication tracking?")}
      body={confirm === "enable"
        ? t("Ovis installs its Herdr wrapper and adds a managed block to these shell files: {profiles}. This applies to new Herdr terminals on this PC. Relaunch existing agents afterward. The original Herdr stays installed; commands keep working while Ovis is closed. Only calls through the wrapper are tracked, without message contents.", { profiles: status?.profiles.join(", ") ?? "" })
        : t("Ovis stops recording new CLI links and removes its shell setup. Existing agents can keep using Herdr, and previously recorded links remain.")}
      confirmLabel={confirm === "enable" ? t("Enable") : t("Disable")} destructive={false}
      onClose={() => setConfirm(null)} onConfirm={async () => {
        let updated: CommunicationTrackingStatus;
        try { updated = await setCommunicationTracking(machineId, confirm === "enable", status); }
        catch (cause) {
          // A partial setup can still be disabled after Cancel; keep the original error in the dialog.
          try { setStatus(await fetchCommunicationTracking(machineId)); } catch {}
          throw cause;
        }
        setStatus(updated); setError(null); setConfirm(null);
        requestAnimationFrame(() => action.current?.focus());
      }} />}
  </SettingsGroup>;
}
