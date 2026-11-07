import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import GraphView from "../src/features/graph/GraphView.tsx";
import type { GraphData } from "../src/features/graph/graphModel.ts";
import { SettingsProvider } from "../src/lib/settings.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "repository", label: "Orchard" },
    { id: "checkout", kind: "checkout", label: "Seedling", machineId: "north", detail: "/fictional/orchard/seedling" },
    { id: "session", kind: "session", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "execution", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "done", kind: "session", label: "Harvest", status: "done", freshness: "stale" },
    { id: "offline", kind: "session", label: "Compost", status: "blocked", freshness: "disconnected", machineId: "south" },
  ],
  edges: [
    { id: "a", source: "execution", target: "checkout", kind: "execution-in-checkout", evidence: "Recorded checkout: seedling" },
    { id: "b", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "Recorded repository: orchard" },
    { id: "c", source: "execution", target: "session", kind: "session-execution", evidence: "Recorded session: prune" },
  ],
};
function Fixture() {
  const [shown, setShown] = useState(true);
  const [data, setData] = useState(fixture);
  const [opened, setOpened] = useState("");
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <nav aria-label="Fixture actions">
      <button onClick={() => setShown((value) => !value)}>Switch view</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: [...previous.nodes].reverse().map((node) => node.id === "session" ? { ...node, machineId: "south", status: "blocked" } : node) }))}>Live update</button>
      <output aria-label="Opened target">{opened}</output>
    </nav>
    {shown && <GraphView data={data} canOpenNode={(id) => ["session", "execution"].includes(id)} onOpenNode={setOpened} machineNames={new Map([["north", "North garden"], ["south", "South garden"]])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
