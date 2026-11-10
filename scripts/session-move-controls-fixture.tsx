import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { GraphRegistryRow } from "../shared/graph-registry-inventory.ts";
import { useT } from "../src/lib/i18n.ts";
import { fetchSessionMoves, type SessionMoveState } from "../src/lib/sessionMoves.ts";
import type { GraphRegistry } from "../shared/graph-registry.ts";
import type { Machine, PaneTarget } from "../shared/machines.ts";
interface MoveFixtureProps { registry: GraphRegistry | null; rows: readonly GraphRegistryRow[]; machines: readonly Machine[]; error: string | null; refresh(): Promise<void>; onOpenTarget(target: PaneTarget): void }
import { SessionMoveDialog } from "../src/components/SessionMoveDialog.tsx";

const unfinished = (state: SessionMoveState): boolean => state.record.phase !== "complete" && state.record.phase !== "cancelled";

/** Transfer state stays outside App's view/navigation hooks and outside the logical registry. */
export function SessionMoveFixtureControls(props: MoveFixtureProps) {
  const t = useT();
  const [moves, setMoves] = useState<SessionMoveState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [selected, setSelected] = useState<{ row: GraphRegistryRow | null; id: string | null } | null>(null);
  const generation = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const completed = useRef(new Set<string>());
  const read = useCallback(async (): Promise<void> => {
    if (reading.current) return;
    const controller = new AbortController(), at = generation.current;
    reading.current = controller;
    try {
      const next = await fetchSessionMoves(controller.signal);
      if (!mounted.current || at !== generation.current) return;
      setMoves(next); setLoaded(true); setStatusError(false);
      const changed = next.some((state) => state.record.phase === "complete" && !completed.current.has(state.record.id));
      for (const state of next) if (state.record.phase === "complete") completed.current.add(state.record.id);
      if (changed) void props.refresh();
    } catch {
      if (mounted.current && !controller.signal.aborted && at === generation.current) setStatusError(true);
    } finally { if (reading.current === controller) reading.current = null; }
  }, [props.refresh]);
  useEffect(() => {
    mounted.current = true; void read();
    const focus = () => void read();
    window.addEventListener("focus", focus);
    return () => { mounted.current = false; reading.current?.abort(); reading.current = null; window.removeEventListener("focus", focus); };
  }, [read]);
  const polling = selected !== null || moves.some(unfinished) || statusError;
  useEffect(() => { if (!polling) return; const timer = window.setInterval(() => void read(), 2000); return () => clearInterval(timer); }, [polling, read]);
  const receive = (state: SessionMoveState): void => {
    generation.current++; setLoaded(true); setStatusError(false);
    setSelected((current) => current && !current.id && current.row?.execution?.id === state.record.plan.request.source_execution_id ? { ...current, id: state.record.id } : current);
    setMoves((previous) => [...previous.filter((item) => item.record.id !== state.record.id), state]);
    if (state.record.phase === "complete" && !completed.current.has(state.record.id)) { completed.current.add(state.record.id); void props.refresh(); }
  };
  const active = selected ? moves.find((state) => selected.id ? state.record.id === selected.id : state.record.plan.request.source_execution_id === selected.row?.execution?.id && unfinished(state)) ?? null : null;
  useEffect(() => { if (active && selected && !selected.id) setSelected({ ...selected, id: active.record.id }); }, [active?.record.id, selected?.id]);
  const close = useCallback(() => { setSelected(null); void read(); }, [read]);
  const selectedRow = selected?.row ?? props.rows.find((row) => row.execution?.id === active?.record.plan.request.source_execution_id) ?? null;
  const sessionName = selectedRow?.name ?? props.registry?.sessions.find((session) => session.id === active?.record.plan.request.session_id)?.name ?? t("Session");
  const action = (row: GraphRegistryRow) => {
    const existing = moves.find((state) => unfinished(state) && (state.record.plan.request.source_execution_id === row.execution?.id || (state.record.plan.request.session_id === row.session?.id && row.session?.current_execution_id === row.execution?.id)));
    const current = !!row.execution && row.execution.agent === "codex" && row.session?.current_execution_id === row.execution.id && !!row.checkout;
    if (!existing && !current) return null;
    const connected = props.machines.some((machine) => machine.id === row.machine_id && machine.enabled && machine.state === "connected");
    return <><button type="button" className="btn btn-ghost session-move-action" disabled={!loaded || statusError || (!existing && (!connected || !props.registry || !!props.error))} onClick={() => setSelected({ row, id: existing?.record.id ?? null })}><ArrowRightLeft size={14} aria-hidden="true" />{existing ? t("View move") : t("Move session")}</button></>;
  };
  return <>
    {statusError && <p className="session-move-error" role="alert">{t("Move status is unavailable. Refresh before starting or retrying a move.")} <button type="button" className="btn btn-ghost" onClick={() => void read()}>{t("Refresh")}</button></p>}
    {moves.some(unfinished) && <aside className="session-move-pending" aria-label={t("Pending session moves")}><span>{t("Pending session moves")}</span>{moves.filter(unfinished).map((state) => <button key={state.record.id} type="button" className="btn btn-ghost" onClick={() => setSelected({ row: props.rows.find((row) => row.execution?.id === state.record.plan.request.source_execution_id) ?? null, id: state.record.id })}>{t("View move")}{" · "}{props.registry?.sessions.find((session) => session.id === state.record.plan.request.session_id)?.name ?? state.record.plan.request.session_id}</button>)}</aside>}
    <section aria-label="Fixture sessions">{props.rows.map((row) => <div key={row.id} data-row-id={row.id}><span>{row.name}</span>{action(row)}</div>)}</section>
    {selected && <SessionMoveDialog rows={props.rows} row={selectedRow} name={sessionName} machines={props.machines} state={active} statusError={statusError} onState={receive} onClose={close} onOpenTarget={props.onOpenTarget} />}
  </>;
}
