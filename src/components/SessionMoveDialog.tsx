import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, X } from "lucide-react";
import { sameFlockBinding, type FlockRow } from "../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../shared/machines.ts";
import type { SessionMovePhase } from "../../shared/session-move.ts";
import { ApiError } from "../lib/api.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { cancelSessionMove, previewSessionMove, runSessionMove, type SessionMoveState } from "../lib/sessionMoves.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import "./SessionMoveDialog.css";

export function movePhaseWord(phase: SessionMovePhase, t: Translate): string {
  switch (phase) {
    case "preview": return t("Transfer preview");
    case "quiescing": return t("Waiting for native Codex exit");
    case "snapshotting": return t("Saving the source snapshot");
    case "snapshotted": return t("Source snapshot saved");
    case "restoring": return t("Transferring and restoring files");
    case "restored": return t("Destination files restored");
    case "launching": return t("Resuming Codex on the destination");
    case "verifying": return t("Verifying native session history");
    case "binding": return t("Recording the new execution");
    case "complete": return t("Session moved");
    case "cancelled": return t("Move cancelled");
  }
}
export function moveRefusal(code: string | null | undefined, t: Translate, phase?: SessionMovePhase): string {
  if (["source_store_unknown", "source_unobserved", "source_observation_missing"].includes(code ?? "")) {
    return phase && !["preview", "quiescing"].includes(phase)
      ? t("The source store could not be verified. Keep the existing transfer and check its destination before retrying.")
      : t("Open this session in Codex on the source PC and preview it while the client is still open.");
  }
  if (code === "source_not_quiescent" && phase && ["launching", "verifying", "binding"].includes(phase)) return t("A destination launch may already exist. Check its status before continuing; Ovis will not start another copy.");
  switch (code) {
    case "source_busy": return t("Finish the active Codex turn before previewing or moving this session.");
    case "untracked_scope": return t("Select required session images and refresh the preview before moving.");
    case "unsupported_artifact": return t("This session has unsupported attachments, queued work, goals or native tools. Clear them in Codex before previewing again.");
    case "unsupported_checkout": return t("Resolve unsupported Git state: conflicts, symlinks, submodules, filters or hidden index flags.");
    case "unsupported_runtime": return t("This session requires the built-in OpenAI provider without custom runtime capabilities.");
    case "unsupported_filesystem": return t("Choose a new checkout on the same filesystem as the destination Ovis state directory.");
    case "artifact_path_conflict": return t("Sessions with local images require the same absolute checkout path on the destination.");
    case "source_not_quiescent": return t("Codex still owns this session. Finish the turn and exit its native client, then retry.");
    case "source_changed": case "preview_changed": return t("The source changed. Refresh the preview and review the files before continuing.");
    case "destination_conflict": return t("The destination already contains conflicting work or session data. Choose another checkout or resolve the conflict there.");
    case "machine_unavailable": return t("Both configured PCs must be connected before this move can continue.");
    case "unsupported_history_index": case "codex_incompatible": case "move_unsupported": return t("Both PCs need a compatible Ovis bridge and Codex 0.166.0 on Linux or macOS before this session can move.");
    case "destination_signed_out": return t("Sign in to Codex on the destination, then refresh the preview.");
    case "reconciliation_required": return t("A destination launch may already exist. Check its status before continuing; Ovis will not start another copy.");
    case "resume_mismatch": case "resume_history_mismatch": case "native_history_invalid": return t("The destination session or its history could not be verified. The source copy was retained.");
    case "move_unreadable": return t("The move status format cannot be read. Update Ovis and reload before continuing.");
    default: return t("The move could not continue. Review the source and destination, then try again.");
  }
}
interface Props {
  row: FlockRow | null;
  rows: readonly FlockRow[];
  name: string;
  machines: readonly Machine[];
  state: SessionMoveState | null;
  statusError: boolean;
  onState(state: SessionMoveState): void;
  onClose(): void;
  onOpenTarget(target: PaneTarget): void;
}
const early = (phase: SessionMovePhase): boolean => phase === "preview" || phase === "quiescing";
const uncertain = (phase: SessionMovePhase): boolean => ["launching", "verifying", "binding"].includes(phase);
const samePaths = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Codex's native resume picker informs explicit session selection; transfer adds a reviewed file scope and native-exit step. */
export function SessionMoveDialog({ row, rows, name, machines, state, statusError, onState, onClose, onOpenTarget }: Props) {
  const t = useT();
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const surface = useFocusTrap<HTMLDivElement>(true, { initialFocus: close });
  useSheetSwipe(surface, onClose);
  usePhoneSheetBack(onClose);
  useEffect(() => {
    const body = surface.current?.querySelector<HTMLElement>(".session-move-body");
    if (!body) return;
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !body.contains(focused) || !focused.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) return;
      const field = focused.getBoundingClientRect(), frame = body.getBoundingClientRect();
      if (field.top < frame.top || field.bottom > frame.bottom) focused.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [surface]);
  const record = state?.record ?? null;
  const request = record?.plan.request;
  const sourceMachineId = record?.plan.source_machine_id ?? row?.machine_id ?? "";
  const [destination, setDestination] = useState(request?.destination_machine_id ?? "");
  const [checkout, setCheckout] = useState(request?.destination_checkout ?? "");
  const [untracked, setUntracked] = useState<string[]>(request?.untracked_files ?? []);
  const [nativeExited, setNativeExited] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const candidates = record ? (record.plan as typeof record.plan & { untracked_candidates?: string[] }).untracked_candidates ?? record.plan.files.filter((file) => file.kind === "untracked").map((file) => file.path) : [];
  const destinationReceipt = record?.destination;
  const destinationReported = !!destinationReceipt && rows.some((item) => item.availability === "live" && item.binding && sameFlockBinding({ ...destinationReceipt, agent: "codex" }, item.binding));
  const destinations = machines.filter((machine) => machine.id !== sourceMachineId && machine.enabled && machine.state === "connected");
  const running = state?.running === true;
  const terminal = record?.phase === "complete" || record?.phase === "cancelled";
  const editable = !record || early(record.phase);
  const destinationConnected = destinations.some((machine) => machine.id === destination);
  const absoluteCheckout = checkout.startsWith("/") && !checkout.includes("\0");
  const dirty = !!request && (request.destination_machine_id !== destination || request.destination_checkout !== checkout || !samePaths(request.untracked_files, untracked));
  const missingImages = record?.plan.required_untracked ?? [];
  const stalePreview = record?.error === "source_changed" || record?.error === "preview_changed";
  const canPreview = editable && destinationConnected && absoluteCheckout && !pending && !running && !statusError;
  const canRun = !!record && !terminal && !dirty && !stalePreview && !missingImages.length && destinationConnected && !pending && !running && !statusError && (!early(record.phase) || nativeExited);
  const files = showAll ? record?.plan.files ?? [] : record?.plan.files.slice(0, 200) ?? [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || nativeModalOver(surface.current)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => { if ((pending || running) && !nativeModalOver(surface.current)) surface.current?.focus({ preventScroll: true }); }, [pending, running]);
  useEffect(() => { if (running || record?.phase === "complete") setLocalError(null); }, [running, record?.phase]);
  useEffect(() => { if (record?.error === "source_not_quiescent") setNativeExited(false); }, [record?.error]);

  const change = async (action: "preview" | "run" | "cancel"): Promise<void> => {
    if (pending) return;
    setPending(true); setLocalError(null);
    try {
      if (action === "preview") {
        const sessionId = request?.session_id ?? row?.session?.id;
        const executionId = request?.source_execution_id ?? row?.execution?.id;
        if (!sessionId || !executionId) return;
        onState(await previewSessionMove({ session_id: sessionId, source_execution_id: executionId, destination_machine_id: destination, destination_checkout: checkout, untracked_files: untracked }, record?.id));
      } else if (record) {
        onState(action === "run" ? await runSessionMove(record.id, record.plan.fingerprint) : await cancelSessionMove(record.id));
        if (action === "cancel" && mounted.current) onClose();
      }
    } catch (error) {
      setLocalError(error instanceof ApiError ? moveRefusal(error.code, t, record?.phase) : moveRefusal(null, t, record?.phase));
    } finally { setPending(false); }
  };
  const error = statusError ? t("Move status is unavailable. Refresh before starting or retrying a move.") : localError ?? (record?.error ? moveRefusal(record.error, t, record.phase) : null);
  const sourceName = machines.find((machine) => machine.id === sourceMachineId)?.name ?? row?.machine_name ?? sourceMachineId;
  const destinationName = machines.find((machine) => machine.id === destination)?.name ?? destination;

  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={surface} className="modal session-move-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1}>
      <header className="modal-header"><h2 id={`${id}-title`} className="modal-title">{t("Move session")}</h2><button ref={close} className="icon-button" type="button" aria-label={t("Close")} onClick={onClose}><X size={18} /></button></header>
      <div className="modal-body session-move-body">
        <p id={`${id}-description`}>{t("Move {name} to another PC while keeping its name and work association.", { name })}</p>
        {!record && <p className="session-move-native">{t("First preview the transfer while Codex is still open. Then finish the turn and exit its native client before moving. Ovis will not stop the client for you.")}</p>}
        {record && early(record.phase) && <><p className="session-move-native">{t("Finish the active turn and exit this session in Codex, then continue here. Ovis will not stop the client for you.")}</p><p className="session-move-note">{t("If Codex changes the saved session while exiting, refresh the preview before moving.")}</p></>}
        <div className="session-move-route"><span>{sourceName}</span><ArrowRight size={16} aria-hidden="true" /><span>{destinationName || t("Choose a destination PC")}</span></div>
        <div className="session-move-fields">
          <label htmlFor={`${id}-destination`}>{t("Destination PC")}</label><select id={`${id}-destination`} className="input" value={destination} disabled={!editable || pending || running} onChange={(event) => setDestination(event.target.value)}><option value="">{t("Choose a destination PC")}</option>{destinations.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}{destination && !destinationConnected && <option value={destination} disabled>{destinationName} · {t("Unavailable")}</option>}</select>
          <label htmlFor={`${id}-checkout`}>{t("Destination checkout")}</label><input id={`${id}-checkout`} className="input" type="text" autoComplete="off" spellCheck={false} maxLength={4096} value={checkout} placeholder={row?.checkout?.path ?? "/work/project-moved"} disabled={!editable || pending || running} onChange={(event) => setCheckout(event.target.value)} />
          <p className="session-move-note">{t("Choose a new absolute checkout path. Existing work is never overwritten.")}</p>
        </div>
        {!destinations.length && <p className="session-move-note">{t("Connect another configured PC to move this session.")}</p>}
        {record && <>
          <p className="session-move-progress" role="status" aria-live="polite">{movePhaseWord(record.phase, t)}{running ? "…" : ""}</p>
          {running && <p className="session-move-note">{t("You can close this dialog while the transfer continues.")}</p>}
          {uncertain(record.phase) && !running && <p className="session-move-native">{t("A destination launch may already exist. Check its status before continuing; Ovis will not start another copy.")}</p>}
          {record.phase === "complete" ? <><p>{t("Native history was verified and the new execution was recorded. The source copy was retained.")}</p>{!destinationReported && <p className="session-move-note">{t("Waiting for the destination PC to report the resumed session.")}</p>}</> : <>
            {candidates.length > 0 && <fieldset className="session-move-untracked" disabled={!editable || pending || running}><legend>{t("Untracked work files")}</legend><p className="session-move-note">{t("Only the individual files you select are included.")}</p>{candidates.map((path) => <label key={path}><input type="checkbox" checked={untracked.includes(path)} onChange={(event) => setUntracked((current) => event.target.checked ? [...current, path] : current.filter((item) => item !== path))} /><span>{path}</span></label>)}</fieldset>}
            <details className="session-move-files" open><summary>{t("Files to transfer ({count})", { count: record.plan.files.length })}</summary><ul>{files.map((file, index) => <li key={`${file.kind}:${file.path}:${index}`}><code>{file.path}</code><span>{t("{bytes} bytes", { bytes: file.bytes })}</span></li>)}</ul>{!showAll && record.plan.files.length > files.length && <button type="button" className="btn btn-ghost" onClick={() => setShowAll(true)}>{t("Show all transfer files")}</button>}</details>
            <details className="session-move-exclusions"><summary>{t("Transfer exclusions")}</summary><p>{t("Credentials, source configuration and ignored files are not transferred.")}</p><ul>{record.plan.exclusions.map((exclusion, index) => <li key={`${exclusion}:${index}`}>{exclusion}</li>)}</ul></details>
            {missingImages.length > 0 && <p className="session-move-note">{t("Select required session images and refresh the preview: {files}", { files: missingImages.join(", ") })}</p>}
            {dirty && <p className="session-move-note">{t("Refresh the preview to review this destination and file selection.")}</p>}
            {early(record.phase) && <label className="session-move-confirm"><input type="checkbox" checked={nativeExited} disabled={pending || running} onChange={(event) => setNativeExited(event.target.checked)} /><span>{t("I finished the turn and exited this session in Codex.")}</span></label>}
          </>}
        </>}
        {error && <p className="session-move-error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer session-move-footer">
        {record && !terminal && !uncertain(record.phase) && <button type="button" className="btn btn-ghost" disabled={pending || running || statusError} onClick={() => void change("cancel")}>{t("Cancel move")}</button>}
        {editable && <button type="button" className="btn" disabled={!canPreview} onClick={() => void change("preview")}>{record ? t("Refresh preview") : t("Preview transfer")}</button>}
        {record?.phase === "complete" && record.destination ? <button type="button" className="btn btn-primary" disabled={!destinationReported || statusError} onClick={() => { onOpenTarget({ machine_id: record.destination!.machine_id, pane_id: record.destination!.pane_id }); onClose(); }}>{t("Open moved session")}</button>
          : record && !terminal && <button type="button" className="btn btn-primary" disabled={!canRun} onClick={() => void change("run")}>{uncertain(record.phase) ? t("Check destination") : record.error ? t("Retry move") : t("Move session")}</button>}
      </footer>
    </div>
  </div>, document.body);
}
