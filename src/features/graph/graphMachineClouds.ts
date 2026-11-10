import type { GraphNode } from "./graphModel.ts";
import type { Point, Positions } from "./graphLayout.ts";

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const coordinate = (point: Point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;

function hull(points: Point[]): Point[] {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ordered: Point[]) => {
    const result: Point[] = [];
    for (const point of ordered) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Geometry shares the nodes' live coordinates; it owns no animation or layout state. */
export function graphMachineClouds(nodes: readonly GraphNode[], positions: Positions, appearance: ReadonlyMap<string, { radius: number }>) {
  const machines = new Map<string, Point[]>();
  for (const node of nodes) {
    const point = positions[node.id];
    if (!node.machineId || !point) continue;
    const points = machines.get(node.machineId) ?? [];
    const radius = appearance.get(node.id)!.radius + 34;
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6;
      points.push({ x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius });
    }
    machines.set(node.machineId, points);
  }
  return [...machines].sort(([a], [b]) => a.localeCompare(b)).map(([machineId, points]) => {
    const boundary = hull(points);
    const start = midpoint(boundary.at(-1)!, boundary[0]!);
    const path = `M${coordinate(start)} ${boundary.map((point, index) => `Q${coordinate(point)} ${coordinate(midpoint(point, boundary[(index + 1) % boundary.length]!))}`).join(" ")} Z`;
    return { machineId, path, left: Math.min(...boundary.map((point) => point.x)), right: Math.max(...boundary.map((point) => point.x)),
      top: Math.min(...boundary.map((point) => point.y)), bottom: Math.max(...boundary.map((point) => point.y)) };
  });
}
