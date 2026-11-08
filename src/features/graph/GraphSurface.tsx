import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type CSSProperties } from "react";
import { Circle, CircleCheck, CircleHelp, CirclePause, LoaderCircle, OctagonAlert } from "lucide-react";
import { useT } from "../../lib/i18n.ts";
import { graphFreshnessLabel, graphKindLabel, graphRelationLabel, graphStatusLabel } from "./graphLabels.ts";
import type { GraphData, GraphNode } from "./graphModel.ts";
import { graphAppearance } from "./graphAppearance.ts";
import { zoomAt, type Point, type Positions, type Viewport } from "./graphLayout.ts";

const STATUS_ICON = { waiting: LoaderCircle, working: LoaderCircle, blocked: OctagonAlert, done: CircleCheck, idle: CirclePause, unknown: CircleHelp };

export interface SurfaceProps extends GraphData {
  positions: Positions;
  viewport: Viewport;
  selected: string;
  onSelect(id: string): void;
  onViewport(viewport: Viewport, commit?: boolean): void;
  onMove(id: string, point: Point): void;
  onFit(): void;
  onEndMove(): void;
}

export function GraphSurface({ nodes, edges, positions, viewport, selected, onSelect, onViewport, onMove, onFit, onEndMove }: SurfaceProps) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const arrowId = useId();
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ id: string | null; start: Point; viewport: Viewport; point: Point; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; midpoint: Point; viewport: Viewport } | null>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(800);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const resize = () => setSurfaceWidth(svg.getBoundingClientRect().width);
    const observer = new ResizeObserver(resize); observer.observe(svg); resize();
    return () => observer.disconnect();
  }, []);
  const [hovered, setHovered] = useState<string | null>(null);
  const appearance = useMemo(() => graphAppearance({ nodes, edges }), [nodes, edges]);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const highlighted = hovered && byId.has(hovered) ? hovered : byId.has(selected) ? selected : null;
  const neighbours = new Set(highlighted ? [highlighted] : []);
  for (const edge of edges) {
    if (edge.source === highlighted) neighbours.add(edge.target);
    if (edge.target === highlighted) neighbours.add(edge.source);
  }
  const labels = new Map<string, { text: string; x: number }>();
  const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
  const priority = (node: GraphNode) => {
    if (node.id === highlighted) return 0;
    if (neighbours.has(node.id)) return 1;
    if (node.kind === "repository") return 2;
    if (node.kind === "execution") return 3;
    return 4;
  };
  for (const node of [...nodes].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id))) {
    const point = positions[node.id], prominent = neighbours.has(node.id) || node.kind === "repository";
    if (!point) continue;
    const limit = Math.max(8, Math.min(prominent ? 32 : viewport.k < 0.45 ? 16 : 22, Math.floor((surfaceWidth - 24) / 7)));
    const text = node.label.length > limit ? `${node.label.slice(0, limit - 1)}…` : node.label;
    const width = text.length * 7, screenX = viewport.x + point.x * viewport.k;
    const centre = screenX >= 0 && screenX <= surfaceWidth ? Math.max(width / 2 + 12, Math.min(surfaceWidth - width / 2 - 12, screenX)) : screenX;
    const top = viewport.y + (point.y + appearance.get(node.id)!.radius) * viewport.k + 7;
    const box = { left: centre - width / 2, right: centre + width / 2, top, bottom: top + 15 };
    if (node.id !== highlighted && occupied.some((placed) => box.left < placed.right + 5 && box.right > placed.left - 5 && box.top < placed.bottom + 4 && box.bottom > placed.top - 4)) continue;
    occupied.push(box); labels.set(node.id, { text, x: (centre - screenX) / viewport.k });
  }
  const localPoint = (event: { clientX: number; clientY: number }) => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const begin = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    setHovered(null);
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    const node = (event.target as Element).closest("[data-graph-node]");
    let nearest: string | null = null, distance = Infinity;
    for (const candidate of nodes) {
      const position = positions[candidate.id];
      if (!position) continue;
      const separation = Math.hypot(point.x - viewport.x - position.x * viewport.k, point.y - viewport.y - position.y * viewport.k);
      if (separation < distance && separation <= Math.max(23, appearance.get(candidate.id)!.radius * viewport.k)) { nearest = candidate.id; distance = separation; }
    }
    const id = nearest ?? node?.getAttribute("data-graph-node") ?? null;
    gesture.current = { id, start: point, viewport, point: id ? positions[id]! : point, moved: false };
    if (pointers.current.size > 1) {
      onEndMove();
      gesture.current = null;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, viewport };
    }
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
        const zoom = zoomAt(previous.viewport, distance / previous.distance, previous.midpoint.x, previous.midpoint.y);
        onViewport({ ...zoom, x: zoom.x + midpoint.x - previous.midpoint.x, y: zoom.y + midpoint.y - previous.midpoint.y }, false);
      }
      return;
    }
    const drag = gesture.current;
    if (!drag) return;
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.id) onMove(drag.id, { x: drag.point.x + dx / drag.viewport.k, y: drag.point.y + dy / drag.viewport.k });
    else onViewport({ ...drag.viewport, x: drag.viewport.x + dx, y: drag.viewport.y + dy }, false);
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.type !== "pointercancel" && gesture.current && !gesture.current.moved) onSelect(gesture.current.id ?? "");
    onEndMove();
    onViewport(viewport);
    gesture.current = null; pinch.current = null;
  };
  useEffect(() => () => onEndMove(), []);
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onEndMove(); onViewport(viewport); gesture.current = null; pointers.current.clear(); pinch.current = null; setHovered(null); onSelect(""); return; }
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
    onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onPointerLeave={() => setHovered(null)} onLostPointerCapture={() => { onEndMove(); onViewport(viewport); gesture.current = null; pointers.current.clear(); pinch.current = null; }} onKeyDown={keyDown}>
    <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrowhead" /></marker></defs>
    <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
      {edges.map((edge) => {
        const a = positions[edge.source], b = positions[edge.target];
        if (!a || !b) return null;
        const related = edge.source === highlighted || edge.target === highlighted;
        const directed = edge.kind === "delegation" || edge.kind === "communication";
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const inset = Math.min(1, (appearance.get(edge.target)!.radius + 3) / distance);
        return <g key={edge.id} className={`graph-edge graph-edge-${edge.kind}${highlighted ? related ? " graph-related" : " graph-muted" : ""}`}>
          <title>{`${byId.get(edge.source)?.label} → ${byId.get(edge.target)?.label}: ${graphRelationLabel(t, edge.kind)} · ${edge.evidence}`}</title>
          <line x1={a.x} y1={a.y} x2={b.x - dx * inset} y2={b.y - dy * inset} markerEnd={directed ? `url(#${arrowId})` : undefined} vectorEffect="non-scaling-stroke" />
        </g>;
      })}
      {nodes.map((node) => {
        const point = positions[node.id];
        if (!point) return null;
        const Icon = node.status ? STATUS_ICON[node.status] : Circle;
        const style = appearance.get(node.id)!;
        const label = labels.get(node.id);
        return <g key={node.id} data-graph-node={node.id} className={`graph-node graph-status-${node.status ?? "unknown"}${selected === node.id ? " graph-selected" : ""}${node.freshness && node.freshness !== "live" ? " graph-stale" : ""}${highlighted ? neighbours.has(node.id) ? " graph-related" : " graph-muted" : ""}`}
          style={{ "--repository-colour": style.colour } as CSSProperties} data-degree={style.degree} data-radius={style.radius} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={nodeLabel(node)} aria-pressed={selected === node.id}
          onPointerEnter={(event) => { if (event.pointerType === "mouse" && event.buttons === 0) setHovered(node.id); }} onPointerLeave={() => setHovered(null)}
          onClick={(event) => { if (event.detail === 0) { setHovered(null); onSelect(node.id); } }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHovered(null); onSelect(node.id); } }}>
          <title>{nodeLabel(node)}</title>
          <circle className="graph-node-hit" r={Math.max(style.radius + 5, 23 / viewport.k)} />
          <circle className="graph-node-disc" r={style.radius} />
          <Icon x={style.radius - 7} y={-style.radius - 7} width={14} height={14} aria-hidden="true" className="graph-status-icon" />
          {label && <text textAnchor="middle" x={label.x} y={style.radius + 19 / viewport.k} style={{ fontSize: 12 / viewport.k, strokeWidth: 4 / viewport.k }} className="graph-node-label">{label.text}</text>}

        </g>;
      })}
    </g>
  </svg>;
}
