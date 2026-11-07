import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Focus, Link, Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useT } from "../../lib/i18n.ts";
import { copyText } from "../../lib/clipboard.ts";
import { useMediaQuery } from "../../lib/useMediaQuery.ts";
import { projectGraph, type GraphData, type GraphFilters } from "./graphModel.ts";
import { fitGraph, reconcilePositions, zoomAt } from "./graphLayout.ts";
import { GRAPH_STATUSES, graphFreshnessLabel, graphKindLabel, graphRelationLabel, graphStatusLabel } from "./graphLabels.ts";
import { GraphSurface } from "./GraphSurface.tsx";
import { useGraphState } from "./useGraphState.ts";
import "./GraphView.css";

export interface GraphViewProps {
  data: GraphData;
  /** Resolve by logical node ID against the CURRENT shared inventory, including freshness checks. */
  onOpenNode(id: string): void;
  canOpenNode(id: string): boolean;
  /** Shared inventory/API error, shown alongside retained stale data. */
  error?: string | null;
  machineNames?: ReadonlyMap<string, string>;
}

export default function GraphView({ data, onOpenNode, canOpenNode, error, machineNames }: GraphViewProps) {
  const t = useT();
  const [state, setState, saved] = useGraphState();
  const compact = useMediaQuery("(max-width: 700px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const filtersId = useId(), detailsId = useId();
  const activeFilters = [state.filters.status, state.filters.machine, state.filters.focus, state.filters.showCompleted, state.groupMachine, state.filters.communication !== "recent"].filter(Boolean).length;
  const host = useRef<HTMLDivElement>(null);
  const fitted = useRef(saved);
  const readableStart = useRef(!saved);
  const positions = useMemo(() => reconcilePositions(data.nodes, state.positions, state.groupMachine), [data.nodes, state.positions, state.groupMachine]);
  const view = useMemo(() => projectGraph(data, state.filters), [data, state.filters]);
  const selected = data.nodes.find((node) => node.id === state.selected);
  const focusNodes = data.nodes.filter((node) => ["repository", "session", "work"].includes(node.kind) || node.id === state.filters.focus);
  const machines = [...new Set(data.nodes.flatMap((node) => node.machineId ? [node.machineId] : []))].sort();
  useEffect(() => {
    if (Object.keys(positions).length !== Object.keys(state.positions).length) setState((previous) => ({ ...previous, positions }));
  }, [positions, state.positions, setState]);
  const fit = () => {
    const surface = host.current?.querySelector("svg.graph-surface");
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    setState((previous) => ({ ...previous, viewport: fitGraph(view.nodes.map((node) => positions[node.id]!), box.width, box.height) }));
  };
  useEffect(() => {
    if (fitted.current || !view.nodes.length) return;
    fitted.current = true;
    if (compact && readableStart.current) {
      const node = view.nodes.find((node) => node.id === state.selected) ?? view.nodes.find((node) => node.kind === "session") ?? view.nodes[0]!;
      const point = positions[node.id]!;
      const box = host.current!.querySelector("svg.graph-surface")!.getBoundingClientRect();
      setState((previous) => ({ ...previous, viewport: { x: box.width / 2 - point.x, y: box.height / 2 - point.y, k: 1 } }));
    } else fit();
    readableStart.current = false;
  });
  const filter = (patch: Partial<GraphFilters>) => setState((previous) => ({ ...previous, filters: { ...previous.filters, ...patch } }));
  const zoom = (factor: number) => {
    const box = host.current?.querySelector("svg.graph-surface")?.getBoundingClientRect();
    if (box) setState((previous) => ({ ...previous, viewport: zoomAt(previous.viewport, factor, box.width / 2, box.height / 2) }));
  };
  return <section className="graph-view" aria-label={t("Graph")} ref={host}>
    <div className="graph-controls">
      <label className="graph-search">{t("Search graph")}<input type="search" value={state.filters.search} onChange={(event) => filter({ search: event.target.value })} /></label>
      <button type="button" className="btn graph-filter-toggle" aria-expanded={!compact || filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((open) => !open)}>
        <SlidersHorizontal size={16} aria-hidden="true" />{t("Graph filters")}{activeFilters > 0 && <span className="graph-filter-count" aria-label={t("{count} active", { count: activeFilters })}>{activeFilters}</span>}<ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className="graph-options" id={filtersId} hidden={compact && !filtersOpen}>
      <label>{t("Status")}<select aria-label={t("Status")} value={state.filters.status} onChange={(event) => filter({ status: event.target.value })}>
        <option value="">{t("All statuses")}</option>{GRAPH_STATUSES.map((status) => <option key={status} value={status}>{graphStatusLabel(t, status)}</option>)}
      </select></label>
      <label>{t("Machine")}<select aria-label={t("Machine")} value={state.filters.machine} onChange={(event) => filter({ machine: event.target.value })}>
        <option value="">{t("All machines")}</option>{state.filters.machine && !machines.includes(state.filters.machine) && <option value={state.filters.machine}>{state.filters.machine}</option>}{machines.map((id) => <option key={id} value={id}>{machineNames?.get(id) ?? id}</option>)}
      </select></label>
      <label>{t("Focus graph")}<select aria-label={t("Focus graph")} value={state.filters.focus} onChange={(event) => filter({ focus: event.target.value })}>
        <option value="">{t("Whole graph")}</option>{state.filters.focus && !focusNodes.some((node) => node.id === state.filters.focus) && <option value={state.filters.focus}>{t("This graph focus is unavailable.")}</option>}{focusNodes.map((node) => <option key={node.id} value={node.id}>{node.label}{node.machineId ? ` · ${machineNames?.get(node.machineId) ?? node.machineId}` : ""}</option>)}
      </select></label>
      <label>{t("Communication links")}<select aria-label={t("Communication links")} value={state.filters.communication ?? "recent"} onChange={(event) => filter({ communication: event.target.value as GraphFilters["communication"] })}>
        <option value="recent">{t("Last 24 hours")}</option><option value="all">{t("All recorded activity")}</option><option value="none">{t("Hidden")}</option>
      </select></label>
      <label>{t("Inspect node")}<select aria-label={t("Inspect node")} value={view.nodes.some((node) => node.id === state.selected) ? state.selected : ""} onChange={(event) => setState((previous) => ({ ...previous, selected: event.target.value }))}>
        <option value="">{t("Select a node")}</option>{view.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {graphKindLabel(t, node.kind)}{node.machineId ? ` · ${machineNames?.get(node.machineId) ?? node.machineId}` : ""}</option>)}
      </select></label>
      <label className="graph-check"><input type="checkbox" checked={state.filters.showCompleted} onChange={(event) => filter({ showCompleted: event.target.checked })} />{t("Show completed")}</label>
      <label className="graph-check"><input type="checkbox" checked={state.groupMachine} onChange={(event) => {
        const groupMachine = event.target.checked;
        fitted.current = false;
        setState((previous) => ({ ...previous, groupMachine, positions: reconcilePositions(data.nodes, {}, groupMachine) }));
      }} />{t("Group by machine")}</label>
      </div>
    </div>
    {error && <p className="graph-warning" role="status">{error}</p>}
    <div className="graph-body">
      <div className="graph-stage">
        <GraphSurface nodes={view.nodes} edges={view.edges} positions={positions} viewport={state.viewport} selected={state.selected}
          onSelect={(selected) => setState((previous) => ({ ...previous, selected }))} onViewport={(viewport) => setState((previous) => ({ ...previous, viewport }))}
          onMove={(id, point) => setState((previous) => ({ ...previous, positions: { ...previous.positions, [id]: point } }))} onFit={fit} />
        {!view.nodes.length && <p className="graph-empty" role="status">{view.focusMissing ? t("This graph focus is unavailable.") : t("No graph nodes match these filters.")}</p>}
        <div className="graph-tools" role="group" aria-label={t("Graph viewport")}>
          <button type="button" title={t("Zoom in")} aria-label={t("Zoom in")} onClick={() => zoom(1.25)}><Plus size={18} /></button>
          <button type="button" title={t("Zoom out")} aria-label={t("Zoom out")} onClick={() => zoom(0.8)}><Minus size={18} /></button>
          <button type="button" title={t("Fit graph")} aria-label={t("Fit graph")} onClick={fit}><Focus size={18} /></button>
          <button type="button" title={t("Reset graph layout")} aria-label={t("Reset graph layout")} onClick={() => { setState((previous) => ({ ...previous, positions: reconcilePositions(data.nodes, {}, previous.groupMachine) })); fitted.current = false; }}><RotateCcw size={18} /></button>
          <button type="button" title={t("Copy graph link")} aria-label={t("Copy graph link")} onClick={() => { void copyText(window.location.href); }}><Link size={18} /></button>
        </div>
      </div>
      <aside className="graph-details" aria-label={t("Graph details")}>
        {selected && <h2>{selected.label}</h2>}
        {selected ? <>
          <p className="graph-selected-meta"><span>{graphKindLabel(t, selected.kind)} · {graphStatusLabel(t, selected.status ?? "unknown")}</span>
          {selected.freshness && <span className={selected.freshness === "live" ? undefined : "graph-warning"}>{graphFreshnessLabel(t, selected.freshness)}</span>}</p>
        </> : <p className="graph-selection-hint">{state.selected ? t("The selected node is unavailable.") : t("Select a node to inspect its status and relationships.")}</p>}
        <div className="graph-selection-actions">
          {selected && <button type="button" className="btn btn-primary" disabled={!canOpenNode(selected.id)} onClick={() => onOpenNode(selected.id)}>{t("Open in Workspace")}</button>}
          <button type="button" className="btn graph-details-toggle" aria-label={t("Details and help")} aria-expanded={!compact || detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((open) => !open)}>{t("Details")}<ChevronDown size={16} aria-hidden="true" /></button>
        </div>
        {selected && !canOpenNode(selected.id) && <p className="graph-target-note">{t("No verified live terminal target.")}</p>}
        <div className="graph-details-extra" id={detailsId} hidden={compact && !detailsOpen}>
        {selected && <>
          {selected.machineId && <p>{machineNames?.get(selected.machineId) ?? selected.machineId}</p>}
          {selected.detail && <p className="graph-detail-path">{selected.detail}</p>}
          <button type="button" className="btn" onClick={() => filter({ focus: selected.id })}>{t("Focus this node")}</button>
          <ul className="graph-relations">{view.edges.filter((edge) => edge.evidence.trim() && (edge.source === selected.id || edge.target === selected.id)).map((edge) => {
            const neighbour = data.nodes.find((node) => node.id === (edge.source === selected.id ? edge.target : edge.source));
            if (!neighbour) return null;
            return <li key={edge.id}>{graphRelationLabel(t, edge.kind)} {edge.source === selected.id ? "→" : "←"}<button type="button" className="btn btn-ghost" onClick={() => setState((previous) => ({ ...previous, selected: neighbour.id }))}>{neighbour.label}</button><small>{edge.eventCount ? <>{t("{count} recorded events", { count: edge.eventCount })} · {t("Last activity")}: <time dateTime={edge.lastObservedAt}>{new Date(edge.lastObservedAt!).toLocaleString()}</time> · Codex</> : edge.evidence}</small></li>;
          })}</ul>
        </>}
        <p className="graph-help">{t("Drag to pan or move nodes. Pinch or scroll to zoom. Use arrow keys to pan, +/− to zoom and 0 to fit.")}</p>
        <p className="graph-help">{t("Links show recorded relationships only. Delegation and dependencies are absent when the source does not report them.")}</p>
        <p className="graph-help">{t("Automatic links use supported Codex success receipts. Plain Herdr commands are not observed.")}</p>
        <p className="graph-help" aria-live="polite">{t("{nodes} nodes · {edges} links", { nodes: view.nodes.length, edges: view.edges.length })}</p>
        </div>
      </aside>
    </div>
  </section>;
}
