import { useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { useMediaQuery } from "../../lib/useMediaQuery.ts";
import { graphSimulation, simulationPositions, type ForceNode } from "./graphSimulation.ts";
import type { GraphData } from "./graphModel.ts";
import type { Point, Positions } from "./graphLayout.ts";

export function useGraphSimulation(data: GraphData, saved: Positions, groupMachine: boolean, reset: number, onSettle: (positions: Positions) => void) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const signature = useMemo(() => JSON.stringify([data.nodes.map((node) => node.id).sort(), [...new Set(data.edges.map((edge) => [edge.source, edge.target].sort().join("\0")))].sort(), groupMachine ? data.nodes.map((node) => [node.id, node.machineId]).sort() : false, reset]), [data, groupMachine, reset]);
  const latest = useRef({ data, saved, onSettle, reducedMotion, groupMachine });
  latest.current = { data, saved, onSettle, reducedMotion, groupMachine };
  const simulation = useRef<Simulation<ForceNode, undefined> | null>(null);
  const [positions, setPositions] = useState<Positions>({});
  const [layoutReset, setLayoutReset] = useState(reset);
  const lastReset = useRef(reset), topology = useRef(""), initialized = useRef(false);
  const livePositions = useRef(saved);
  const activePin = useRef<{ id: string; point: Point } | null>(null);
  const publish = (force: Simulation<ForceNode, undefined>, persist = false) => {
    const next = simulationPositions(force.nodes());
    livePositions.current = { ...livePositions.current, ...next };
    setPositions(next);
    if (persist) latest.current.onSettle(next);
  };
  useEffect(() => {
    const current = latest.current;
    const unchanged = topology.current === signature;
    const firstVisible = !initialized.current || !Object.keys(livePositions.current).length;
    initialized.current = true;
    topology.current = signature;
    const rebuilding = lastReset.current !== reset;
    const previous = rebuilding ? {} : { ...current.saved, ...livePositions.current };
    lastReset.current = reset;
    if (rebuilding) activePin.current = null;
    const force = graphSimulation(current.data, previous, current.groupMachine);
    simulation.current = force;
    if (activePin.current) {
      const pin = activePin.current, node = force.nodes().find((node) => node.id === pin.id);
      if (node) { node.fx = node.x = pin.point.x; node.fy = node.y = pin.point.y; force.alphaTarget(0.12); }
      else activePin.current = null;
    }
    force.on("tick", () => publish(force)).on("end", () => publish(force, true));
    if (!current.data.nodes.length || firstVisible || rebuilding || current.reducedMotion || unchanged) {
      if (rebuilding || (!firstVisible && !unchanged) || !current.data.nodes.every((node) => previous[node.id])) force.tick(300);
      publish(force, activePin.current === null);
    } else force.alpha(0.5).restart();
    publish(force); setLayoutReset(reset);
    return () => { livePositions.current = { ...livePositions.current, ...simulationPositions(force.nodes()) }; force.stop(); force.on("tick", null).on("end", null); for (const node of force.nodes()) { node.fx = null; node.fy = null; } simulation.current = null; };
  }, [signature]);
  const endDrag = () => {
    activePin.current = null;
    const force = simulation.current;
    if (!force || !force.nodes().some((node) => node.fx != null || node.fy != null)) return;
    for (const node of force.nodes()) { node.fx = null; node.fy = null; }
    force.alphaTarget(0);
    if (latest.current.reducedMotion) force.stop().tick(8);
    publish(force, true);
  };
  const move = (id: string, point: Point) => {
    const force = simulation.current, node = force?.nodes().find((item) => item.id === id);
    if (!force || !node) return;
    activePin.current = { id, point };
    node.fx = node.x = point.x; node.fy = node.y = point.y;
    force.alpha(0.35).alphaTarget(0.12);
    if (latest.current.reducedMotion) { force.stop().tick(); publish(force); }
    else { publish(force); force.restart(); }
  };
  return { positions, move, endDrag, layoutReset };
}
