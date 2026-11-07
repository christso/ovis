import type { GraphNode } from "./graphModel.ts";

export interface Point { x: number; y: number }
export interface Viewport extends Point { k: number }
export type Positions = Record<string, Point>;
const COLUMN = { repository: 0, checkout: 1, work: 2, session: 3, execution: 4 };

/** Existing positions (including filtered nodes) are immutable until an explicit drag/reset. */
export function reconcilePositions(nodes: readonly GraphNode[], previous: Positions, groupMachine = false): Positions {
  const next: Positions = Object.assign(Object.create(null), previous);
  const occupied = new Set(Object.values(next).map((point) => `${point.x},${point.y}`));
  const machines = [...new Set(nodes.map((node) => node.machineId ?? ""))].sort();
  const machineBands = new Map<string, number>();
  let nextBand = 0;
  for (const machine of machines) {
    const columns = new Map<number, number>();
    for (const node of nodes) {
      if ((node.machineId ?? "") !== machine) continue;
      const column = COLUMN[node.kind]; columns.set(column, (columns.get(column) ?? 0) + 1);
    }
    machineBands.set(machine, nextBand);
    nextBand += (Math.max(1, ...columns.values()) + 1) * 100;
  }
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (Object.hasOwn(next, node.id)) continue;
    const x = COLUMN[node.kind] * 280;
    const band = groupMachine ? machineBands.get(node.machineId ?? "")! : 0;
    let y = band;
    while (occupied.has(`${x},${y}`)) y += 100;
    next[node.id] = { x, y }; occupied.add(`${x},${y}`);
  }
  return next;
}

export function fitGraph(points: readonly Point[], width: number, height: number): Viewport {
  if (!points.length) return { x: width / 2, y: height / 2, k: 1 };
  const minX = Math.min(...points.map((p) => p.x)) - 120;
  const maxX = Math.max(...points.map((p) => p.x)) + 120;
  const minY = Math.min(...points.map((p) => p.y)) - 40;
  const maxY = Math.max(...points.map((p) => p.y)) + 40;
  const k = Math.max(0.08, Math.min(1.3, (width - 48) / (maxX - minX), (height - 48) / (maxY - minY)));
  return { k, x: width / 2 - (minX + maxX) / 2 * k, y: height / 2 - (minY + maxY) / 2 * k };
}

export function zoomAt(viewport: Viewport, factor: number, x: number, y: number): Viewport {
  const k = Math.max(0.08, Math.min(4, viewport.k * factor));
  return { k, x: x - (x - viewport.x) * k / viewport.k, y: y - (y - viewport.y) * k / viewport.k };
}
