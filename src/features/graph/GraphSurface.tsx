import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Circle, CircleCheck, CircleHelp, CirclePause, LoaderCircle, OctagonAlert } from "lucide-react";
import { useT } from "../../lib/i18n.ts";
import { graphFreshnessLabel, graphKindLabel, graphRelationLabel, graphStatusLabel } from "./graphLabels.ts";
import type { GraphData, GraphNode } from "./graphModel.ts";
import { zoomAt, type Point, type Positions, type Viewport } from "./graphLayout.ts";

const STATUS_ICON = { waiting: LoaderCircle, working: LoaderCircle, blocked: OctagonAlert, done: CircleCheck, idle: CirclePause, unknown: CircleHelp };

export interface SurfaceProps extends GraphData {
  positions: Positions;
  viewport: Viewport;
  selected: string;
  onSelect(id: string): void;
  onViewport(viewport: Viewport): void;
  onMove(id: string, point: Point): void;
  onFit(): void;
}

export function GraphSurface({ nodes, edges, positions, viewport, selected, onSelect, onViewport, onMove, onFit }: SurfaceProps) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ id: string | null; start: Point; viewport: Viewport; point: Point; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; midpoint: Point } | null>(null);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const localPoint = (event: { clientX: number; clientY: number }) => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const begin = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    const node = (event.target as Element).closest("[data-graph-node]");
    const id = node?.getAttribute("data-graph-node") ?? null;
    gesture.current = { id, start: point, viewport, point: id ? positions[id]! : point, moved: false };
    if (pointers.current.size > 1) { gesture.current = null; pinch.current = null; }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const previous = pinch.current;
      if (previous && previous.distance > 0) {
        const zoom = zoomAt(viewport, distance / previous.distance, previous.midpoint.x, previous.midpoint.y);
        onViewport({ ...zoom, x: zoom.x + midpoint.x - previous.midpoint.x, y: zoom.y + midpoint.y - previous.midpoint.y });
      }
      pinch.current = { distance, midpoint };
      return;
    }
    const drag = gesture.current;
    if (!drag) return;
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.id) onMove(drag.id, { x: drag.point.x + dx / drag.viewport.k, y: drag.point.y + dy / drag.viewport.k });
    else onViewport({ ...drag.viewport, x: drag.viewport.x + dx, y: drag.viewport.y + dy });
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.type !== "pointercancel" && gesture.current?.id && !gesture.current.moved) onSelect(gesture.current.id);
    gesture.current = null; pinch.current = null;
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const shifts: Record<string, Point> = { ArrowLeft: { x: 60, y: 0 }, ArrowRight: { x: -60, y: 0 }, ArrowUp: { x: 0, y: 60 }, ArrowDown: { x: 0, y: -60 } };
    const shift = shifts[event.key];
    if (shift) { event.preventDefault(); onViewport({ ...viewport, x: viewport.x + shift.x, y: viewport.y + shift.y }); }
    if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); const box = svgRef.current!.getBoundingClientRect(); onViewport(zoomAt(viewport, event.key === "-" ? 0.8 : 1.25, box.width / 2, box.height / 2)); }
    if (event.key === "0") { event.preventDefault(); onFit(); }
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const point = localPoint(event); onViewport(zoomAt(viewport, Math.exp(-event.deltaY * 0.002), point.x, point.y)); };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  });
  const nodeLabel = (node: GraphNode) => `${node.label} · ${graphStatusLabel(t, node.status ?? "unknown")} · ${node.freshness ? graphFreshnessLabel(t, node.freshness) : graphKindLabel(t, node.kind)}`;
  return <svg ref={svgRef} className="graph-surface" role="group" aria-label={t("Interactive graph")} tabIndex={0}
    onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { gesture.current = null; pointers.current.clear(); pinch.current = null; }} onKeyDown={keyDown}>
    <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
      {edges.map((edge) => {
        const a = positions[edge.source], b = positions[edge.target];
        if (!a || !b) return null;
        return <g key={edge.id} className={`graph-edge graph-edge-${edge.kind}`}>
          <title>{`${byId.get(edge.source)?.label} → ${byId.get(edge.target)?.label}: ${graphRelationLabel(t, edge.kind)} · ${edge.evidence}`}</title>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />
        </g>;
      })}
      {nodes.map((node) => {
        const point = positions[node.id];
        if (!point) return null;
        const Icon = node.status ? STATUS_ICON[node.status] : Circle;
        return <g key={node.id} data-graph-node={node.id} className={`graph-node graph-status-${node.status ?? "unknown"}${selected === node.id ? " graph-selected" : ""}${node.freshness && node.freshness !== "live" ? " graph-stale" : ""}`}
          transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={nodeLabel(node)} aria-pressed={selected === node.id}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}>
          <title>{nodeLabel(node)}</title>
          <rect x={-112} y={-30} width={224} height={60} rx={10} />
          <Icon x={-98} y={-17} width={18} height={18} aria-hidden="true" className="graph-status-icon" />
          <text x={-72} y={-3} className="graph-node-label">{node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}</text>
          <text x={-72} y={17} className="graph-node-kind">{graphKindLabel(t, node.kind)}{node.freshness && node.freshness !== "live" ? ` · ${graphFreshnessLabel(t, node.freshness)}` : ""}</text>
        </g>;
      })}
    </g>
  </svg>;
}
