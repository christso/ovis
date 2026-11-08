import type { GraphNode } from "./graphModel.ts";

export interface Point { x: number; y: number }
export interface Viewport extends Point { k: number }
export type Positions = Record<string, Point>;
export function reconcilePositions(nodes: readonly GraphNode[], previous: Positions, _groupMachine = false): Positions {
  const next: Positions = Object.assign(Object.create(null), previous);
  for (const [index, node] of [...nodes].sort((a, b) => a.id.localeCompare(b.id)).entries()) {
    if (Object.hasOwn(next, node.id)) continue;
    const slot = index + Object.keys(previous).length;
    const angle = slot * Math.PI * (3 - Math.sqrt(5));
    const radius = 42 * Math.sqrt(slot + 0.5);
    next[node.id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  return next;
}

export function fitGraph(points: readonly Point[], width: number, height: number): Viewport {
  if (!points.length) return { x: width / 2, y: height / 2, k: 1 };
  const minX = Math.min(...points.map((p) => p.x)) - 92;
  const maxX = Math.max(...points.map((p) => p.x)) + 92;
  const minY = Math.min(...points.map((p) => p.y)) - 55;
  const maxY = Math.max(...points.map((p) => p.y)) + 55;
  const k = Math.max(0.08, Math.min(1.3, (width - 48) / (maxX - minX), (height - 130) / (maxY - minY)));
  return { k, x: width / 2 - (minX + maxX) / 2 * k, y: (height - 70) / 2 - (minY + maxY) / 2 * k };
}

export function zoomAt(viewport: Viewport, factor: number, x: number, y: number): Viewport {
  const k = Math.max(0.08, Math.min(4, viewport.k * factor));
  return { k, x: x - (x - viewport.x) * k / viewport.k, y: y - (y - viewport.y) * k / viewport.k };
}
