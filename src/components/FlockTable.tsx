import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { FlockCommand, FlockRegistry } from "../../shared/flock.ts";
import { flockTarget, type FlockRow } from "../../shared/flock-inventory.ts";
import type { Machine, PaneTarget } from "../../shared/machines.ts";
import { ApiError } from "../lib/api.ts";
import { flockColumn, flockTableRows, type FlockColumn } from "../lib/flockTable.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
import { flockRelationshipEndpoint, flockRelationships } from "../../shared/flock-relationships.ts";
import { useT } from "../lib/i18n.ts";
import type { Translate } from "../lib/i18n.ts";
import "./FlockTable.css";

export interface FlockTableProps {
  registry: FlockRegistry | null;
  rows: readonly FlockRow[];
  machines: readonly Machine[];
  selected: PaneTarget | null;
  error: string | null;
  refresh(): Promise<void>;
  change(command: FlockCommand, revision?: number): Promise<void>;
  onOpenTarget(target: PaneTarget): void;
  executionAction?: (row: FlockRow) => ReactNode;
}
function statusWord(row: FlockRow, t: Translate): string {
  if (row.availability === "disconnected") return t("Disconnected");
  if (row.availability === "unavailable") return t("Unavailable");
  if (row.availability === "unsupported") return t("Identity unavailable");
  switch (row.status) {
    case "working": return t("Working");
    case "blocked": return t("Blocked");
    case "done": return t("Done");
    case "idle": return t("Idle");
    default: return row.status;
  }
}

/** One row per execution, across PCs. All operations keep explicit IDs, never display labels. */
export function FlockTable(props: FlockTableProps) {
  const t = useT();
  const compact = useMediaQuery("(max-width: 640px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [machineId, setMachineId] = useState("");
  const [column, setColumn] = useState<FlockColumn>("name");
  const [descending, setDescending] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [editing, setEditing] = useState<FlockRow | "work" | "rename-work" | null>(null);
  const [name, setName] = useState("");
  const [workId, setWorkId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [editRevision, setEditRevision] = useState<number | undefined>();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const prefix = useId();
  useEffect(() => { if (editing !== null) input.current?.focus(); }, [editing]);
  const columns: { id: FlockColumn; label: string }[] = [{ id: "name", label: t("Name") }, { id: "work", label: t("Work") }, { id: "repository", label: t("Repository") }, { id: "branch", label: t("Branch") }, { id: "status", label: t("Status") }, { id: "machine", label: t("Machine") }];
  const activeFilters = Number(Boolean(query.trim())) + Number(Boolean(machineId)) + Number(grouped) + Number(column !== "name" || descending);
  const incompleteSources = props.machines.filter((machine) => machine.state !== "connected" || machine.snapshot === null);
  const visible = useMemo(() => flockTableRows(props.rows, query, machineId, column, descending), [props.rows, query, machineId, column, descending]);
  const relationships = useMemo(() => props.registry ? flockRelationships(props.registry) : [], [props.registry]);
  const groups = useMemo(() => {
    if (!grouped) return [{ id: "", name: "", rows: visible }];
    const byMachine = new Map<string, { id: string; name: string; rows: FlockRow[] }>();
    for (const row of visible) {
      if (!byMachine.has(row.machine_id)) byMachine.set(row.machine_id, { id: row.machine_id, name: row.machine_name, rows: [] });
      byMachine.get(row.machine_id)!.rows.push(row);
    }
    return [...byMachine.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [visible, grouped]);
  const edit = (row: FlockRow | "work" | "rename-work") => {
    setEditing(row); setEditRevision(props.registry?.revision); setName(typeof row === "string" ? row === "rename-work" ? props.registry?.works[0]?.name ?? "" : "" : row.name);
    setWorkId(typeof row === "string" ? row === "rename-work" ? props.registry?.works[0]?.id ?? "" : "" : row.session?.work_id ?? "");
    setSessionId(""); setFormError(null);
  };
  const save = async () => {
    if (editing === null || pending) return;
    const trimmed = name.trim();
    if ((!sessionId || typeof editing === "string" || editing.session) && !trimmed) return;
    let command: FlockCommand;
    if (editing === "work") command = { type: "create-work", name: trimmed };
    else if (editing === "rename-work") command = { type: "rename-work", id: workId, name: trimmed };
    else if (editing.session) command = { type: "rename-session", id: editing.session.id, name: trimmed, work_id: workId || null };
    else if (editing.binding) command = { type: "adopt", binding: editing.binding, ...(sessionId ? { session_id: sessionId } : { name: trimmed, work_id: workId || null }) };
    else return;
    setPending(true); setFormError(null);
    try { await props.change(command, editRevision); setEditing(null); }
    catch (error) { setFormError(error instanceof ApiError && error.code === "flock_conflict" ? t("The registry changed. Cancel and reopen this form to review current values.") : error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  return <section className="flock-table" aria-label={t("Table")}>
    <div className="flock-toolbar">
      <label className="flock-search">{t("Filter sessions")}<input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="button" className="btn flock-refresh" onClick={() => void props.refresh()}>{t("Refresh")}</button>
      <button type="button" className="btn flock-filter-toggle" aria-expanded={filtersOpen} aria-controls={`${prefix}-filters`} onClick={() => setFiltersOpen(!filtersOpen)}>{activeFilters ? t("Filters and sort ({count})", { count: activeFilters }) : t("Filters and sort")}</button>
      <div id={`${prefix}-filters`} className="flock-advanced" hidden={compact && !filtersOpen}>
      <label>{t("Machine")}<select className="input" aria-label={t("Machine")} value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">{t("All machines")}</option>{props.machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
      <label className="flock-check"><input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />{t("Group by machine")}</label>
      <div className="flock-sort">
        <label>{t("Sort by")}<select className="input" value={column} onChange={(event) => { setColumn(event.target.value as FlockColumn); setDescending(false); }}>{columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button type="button" className="btn" aria-pressed={descending} onClick={() => setDescending(!descending)}>{descending ? t("Descending") : t("Ascending")}{descending ? " ↓" : " ↑"}</button>
      </div>
      <div className="flock-toolbar-actions"><button type="button" className="btn" disabled={!props.registry || pending} onClick={() => edit("work")}>{t("New work")}</button>
      <button type="button" className="btn" disabled={!props.registry?.works.length || pending} onClick={() => edit("rename-work")}>{t("Rename work")}</button>
      </div>
      <p className="flock-note">{t("Each row is an execution. Unavailable or unproven sources cannot open a terminal here.")}</p>
      {incompleteSources.length > 0 && <p className="flock-note">{t("Inventory is incomplete for: {machines}.", { machines: incompleteSources.map((machine) => machine.name).join(", ") })}</p>}
      </div>
    </div>
    {props.error && <p className="error-state" role="alert">{props.error}</p>}
    {!props.registry && !props.error && <p>{t("Loading work registry…")}</p>}
    {editing !== null && <form className="flock-editor" aria-label={t("Session association")} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p>{t("Names do not merge sessions. Choose an existing session explicitly to record another execution.")}</p>
      {typeof editing !== "string" && !editing.session && <label>{t("Logical session")}<select className="input" aria-label={t("Logical session")} disabled={pending} value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">{t("New logical session")}</option>{props.registry?.sessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {session.id}</option>)}</select></label>}
      {(sessionId === "" || editing === "rename-work") && <>
        <label htmlFor={`${prefix}-name`}>{t("Name")}</label><input id={`${prefix}-name`} ref={input} className="input" maxLength={200} required value={name} disabled={pending} onChange={(event) => setName(event.target.value)} />
        {editing !== "work" && <label>{t("Work")}<select className="input" aria-label={t("Work")} disabled={pending} value={workId} onChange={(event) => { setWorkId(event.target.value); if (editing === "rename-work") setName(props.registry?.works.find((work) => work.id === event.target.value)?.name ?? ""); }}>{editing !== "rename-work" && <option value="">{t("No work")}</option>}{props.registry?.works.map((work) => <option key={work.id} value={work.id}>{work.name} · {work.id}</option>)}</select></label>}
      </>}
      {formError && <p className="error-state" role="alert">{formError}</p>}
      <div className="flock-editor-actions"><button type="submit" className="btn" disabled={!props.registry || pending || (!sessionId && !name.trim())}>{t("Save association")}</button><button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setEditing(null)}>{t("Cancel")}</button></div>
    </form>}
    <div className="flock-scroll" tabIndex={0} role="region" aria-label={t("Session table")}>
      <table role="table"><caption className="visually-hidden">{t("Sessions across machines")}</caption><thead role="rowgroup"><tr role="row">{columns.map((item) => <th role="columnheader" scope="col" key={item.id} aria-sort={column === item.id ? descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => { if (column === item.id) setDescending(!descending); else { setColumn(item.id); setDescending(false); } }}>{item.label}{column === item.id ? descending ? " ↓" : " ↑" : ""}</button></th>)}<th role="columnheader" scope="col">{t("Actions")}</th></tr></thead>
        {groups.map((group) => <tbody role="rowgroup" key={group.id}>
          {grouped && <tr role="row" className="flock-group"><th role="rowheader" colSpan={7} scope="rowgroup">{group.name || t("Unavailable")}</th></tr>}
          {group.rows.map((row) => {
            const target = flockTarget(row);
            const native = row.execution ?? row.binding;
            const relationshipId = row.session ? `session:${row.session.id}` : props.registry && native?.agent === "codex" ? flockRelationshipEndpoint(props.registry, row.machine_id, native.native_session_id).id : null;
            const related = relationships.filter((relation) => relation.source.id === relationshipId || relation.target.id === relationshipId);
            const selected = target && target.machine_id === props.selected?.machine_id && target.pane_id === props.selected?.pane_id;
            return <tr role="row" key={row.id} data-row-id={row.id} data-selected={selected ? "true" : undefined}>
              <td role="cell" className="flock-name"><button type="button" className="flock-open" aria-current={selected ? "true" : undefined} disabled={!target} onClick={() => { if (target) props.onOpenTarget(target); }}>{row.name}</button></td>
              <td role="cell" className="flock-work" data-empty={!row.work || undefined}><span className="flock-cell-label">{t("Work")}</span><span className="flock-cell-value">{row.work?.name || "—"}</span></td>
              <td role="cell" className="flock-repository" data-empty={!row.checkout?.path || undefined} title={row.checkout?.repository ?? undefined}><span className="flock-cell-label">{t("Checkout")}</span><span className="flock-cell-value flock-checkout-name">{row.checkout?.path.split(/[\\/]/).filter(Boolean).at(-1) || row.checkout?.path}</span><span className="flock-repository-value">{flockColumn(row, "repository") || "—"}</span></td>
              <td role="cell" className="flock-branch" data-empty={!row.checkout?.branch || undefined}><span className="flock-cell-label">{t("Branch")}</span><span className="flock-cell-value">{flockColumn(row, "branch") || "—"}</span></td>
              <td role="cell" className="flock-status"><span>{statusWord(row, t)}</span></td>
              <td role="cell" className="flock-machine"><span className="flock-cell-label">{t("Machine")}</span><span className="flock-cell-value">{row.machine_name || "—"}</span></td>
              <td role="cell" className="flock-actions"><div className="flock-row-actions"><button type="button" className="btn btn-ghost" disabled={pending || !props.registry || (!row.session && (!target || !row.binding))} onClick={() => edit(row)}>{row.session ? t("Edit association") : t("Associate session")}</button>{props.executionAction?.(row)}</div><details><summary>{row.execution ? t("Execution details") : t("Unassociated")}</summary><dl>
                <dt>{t("Name")}</dt><dd>{row.name}</dd>
                <dt>{t("Work")}</dt><dd>{row.work?.name || "—"}</dd>
                <dt>{t("Machine")}</dt><dd>{row.machine_name || "—"}</dd>
                <dt>{t("Repository")}</dt><dd>{flockColumn(row, "repository") || "—"}</dd>
                <dt>{t("Branch")}</dt><dd>{flockColumn(row, "branch") || "—"}</dd>
                {row.session && <><dt>{t("Logical session")}</dt><dd>{row.session.id}</dd></>}
                {row.execution && <><dt>{t("Execution")}</dt><dd>{row.execution.id}{row.session?.current_execution_id === row.execution.id ? ` · ${t("Current")}` : ` · ${t("Previous")}`}</dd></>}
                {row.binding && <><dt>{t("Native session")}</dt><dd>{row.binding.native_session_id}</dd><dt>{t("Pane")}</dt><dd>{row.binding.pane_id}</dd></>}
                {row.checkout && <><dt>{t("Checkout")}</dt><dd>{row.checkout.path}</dd></>}
                <dt>{t("Observed relationships")}</dt><dd>{related.length ? <ul>{related.map((relation) => {
                  const outgoing = relation.source.id === relationshipId;
                  const neighbour = outgoing ? relation.target : relation.source;
                  return <li key={relation.id}>{relation.kind === "delegation" ? t("Delegation") : t("Communication")} {outgoing ? "→" : "←"} <span title={neighbour.native_session_id}>{neighbour.label}</span> · {t("{count} recorded events", { count: relation.count })}<br /><span>{t("Last activity")}: <time dateTime={relation.last_at}>{new Date(relation.last_at).toLocaleString()}</time></span></li>;
                })}</ul> : t("No observed relationships")}</dd>
              </dl></details></td>
            </tr>;
          })}
        </tbody>)}
      </table>
    </div>
    {props.registry && visible.length === 0 && <p>{t("No sessions match")}</p>}
  </section>;
}
