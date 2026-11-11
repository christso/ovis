import { expect, test } from "bun:test";
import type { GraphNode } from "./graphModel.ts";
import { graphMachineClouds } from "./graphMachineClouds.ts";

const nodes: GraphNode[] = [
  { id: "a", kind: "terminal", label: "One", machineId: "north" },
  { id: "b", kind: "terminal", label: "Two", machineId: "north" },
  { id: "c", kind: "terminal", label: "Three", machineId: "south" },
  { id: "unknown", kind: "terminal", label: "Unknown" },
];
const positions = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 500, y: 200 }, unknown: { x: -1000, y: -1000 } };
const radii = new Map(nodes.map((node) => [node.id, { radius: 15 }]));

test("clouds include only positioned visible members with a known machine", () => {
  expect(graphMachineClouds([], positions, radii)).toEqual([]);
  const clouds = graphMachineClouds(nodes, positions, radii);
  expect(clouds.map((cloud) => cloud.machineId)).toEqual(["north", "south"]);
  expect(clouds[0]!.left).toBeLessThan(-15);
  expect(clouds[0]!.right).toBeGreaterThan(115);
  expect(clouds[0]!.left).toBeGreaterThan(-1000);
  expect(graphMachineClouds(nodes.filter((node) => node.machineId !== "north"), positions, radii).map((cloud) => cloud.machineId)).toEqual(["south"]);
  expect(graphMachineClouds(nodes, { a: positions.a }, radii).map((cloud) => cloud.machineId)).toEqual(["north"]);
});

test("single, coincident and collinear groups have finite rounded closed boundaries", () => {
  for (const members of [nodes.slice(0, 1), nodes.slice(0, 2), [...nodes.slice(0, 2), { ...nodes[0]!, id: "d" }]]) {
    for (const b of [positions.b, positions.a]) {
      const cloud = graphMachineClouds(members, { ...positions, b, d: { x: 200, y: 0 } }, new Map([...radii, ["d", { radius: 15 }]]))[0]!;
      expect(cloud.path.startsWith("M")).toBe(true);
      expect(cloud.path.endsWith("Z")).toBe(true);
      expect(cloud.path).toContain("Q");
      expect(cloud.path).not.toMatch(/NaN|Infinity/);
      expect(cloud.right - cloud.left).toBeGreaterThan(30);
      expect(cloud.bottom - cloud.top).toBeGreaterThan(30);
    }
  }
});

test("a moved node reshapes only its machine's cloud", () => {
  const before = graphMachineClouds(nodes, positions, radii);
  const after = graphMachineClouds(nodes, { ...positions, b: { x: 300, y: -200 } }, radii);
  expect(after[0]!.right).toBeGreaterThan(before[0]!.right);
  expect(after[0]!.top).toBeLessThan(before[0]!.top);
  expect(after[0]!.path).not.toBe(before[0]!.path);
  expect(after[1]).toEqual(before[1]);
});

test("cloud geometry is independent of roster order and translates with the group", () => {
  const before = graphMachineClouds(nodes, positions, radii);
  expect(graphMachineClouds([...nodes].reverse(), positions, radii)).toEqual(before);
  const shifted = Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, { x: point.x + 80, y: point.y - 50 }]));
  const after = graphMachineClouds(nodes, shifted, radii);
  for (const [index, cloud] of before.entries()) {
    expect(after[index]!.left).toBeCloseTo(cloud.left + 80);
    expect(after[index]!.right).toBeCloseTo(cloud.right + 80);
    expect(after[index]!.top).toBeCloseTo(cloud.top - 50);
    expect(after[index]!.bottom).toBeCloseTo(cloud.bottom - 50);
  }
});

test("node growth enlarges the cloud bounds used by Fit", () => {
  const before = graphMachineClouds(nodes.slice(0, 1), positions, radii)[0]!;
  const after = graphMachineClouds(nodes.slice(0, 1), positions, new Map([["a", { radius: 80 }]]))[0]!;
  expect(after.left).toBeLessThan(before.left);
  expect(after.right).toBeGreaterThan(before.right);
  expect(after.top).toBeLessThan(before.top);
  expect(after.bottom).toBeGreaterThan(before.bottom);
});
