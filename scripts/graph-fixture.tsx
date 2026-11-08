import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import GraphView from "../src/features/graph/GraphView.tsx";
import type { GraphData } from "../src/features/graph/graphModel.ts";
import { SettingsProvider } from "../src/lib/settings.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "repository", label: "Orchard", repositoryKey: "orchard" },
    { id: "harbour", kind: "repository", label: "Harbour", repositoryKey: "harbour" },
    { id: "quay", kind: "checkout", label: "Quay", machineId: "south" },
    { id: "checkout", kind: "checkout", label: "Seedling", machineId: "north", detail: "/fictional/orchard/seedling" },
    { id: "session", kind: "session", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "execution", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "done", kind: "session", label: "Harvest", status: "done", freshness: "stale" },
    { id: "offline", kind: "session", label: "Compost", status: "blocked", freshness: "disconnected", machineId: "south" },
  ],
  edges: [
    { id: "harbour-checkout", source: "quay", target: "harbour", kind: "checkout-in-repository", evidence: "Recorded repository: harbour" },
    { id: "a", source: "execution", target: "checkout", kind: "execution-in-checkout", evidence: "Recorded checkout: seedling" },
    { id: "b", source: "checkout", target: "repo", kind: "checkout-in-repository", evidence: "Recorded repository: orchard" },
    { id: "c", source: "execution", target: "session", kind: "session-execution", evidence: "Recorded session: prune" },
  ],
};
function denseFixture(): GraphData {
  const nodes: GraphData["nodes"][number][] = [], edges: GraphData["edges"][number][] = [];
  const repositories = ["Orchard", "Harbour", "Observatory", "Library", "Meadow"];
  for (const [index, repository] of repositories.entries()) {
    const repo = `dense-repo-${index}`;
    nodes.push({ id: repo, kind: "repository", label: repository, repositoryKey: repository });
    for (let checkout = 0; checkout < 4; checkout++) {
      const id = `dense-checkout-${index}-${checkout}`;
      nodes.push({ id, kind: "checkout", label: `${repository} branch ${checkout + 1}`, machineId: index % 2 ? "south" : "north" });
      edges.push({ id: `repo-link-${id}`, source: id, target: repo, kind: "checkout-in-repository", evidence: "Fictional native worktree metadata" });
    }
    for (let agent = 0; agent < 25; agent++) {
      const id = `dense-agent-${index}-${agent}`;
      nodes.push({ id, kind: "execution", label: `${repository} task ${agent + 1} · ${agent % 2 ? "Claude" : "Codex"}`, machineId: index % 2 ? "south" : "north", status: agent % 3 ? "working" : "idle", freshness: "live" });
      edges.push({ id: `checkout-link-${id}`, source: id, target: `dense-checkout-${index}-${agent % 4}`, kind: "execution-in-checkout", evidence: "Fictional execution checkout" });
    }
    if (index) edges.push({ id: `dense-communication-${index}`, source: `dense-agent-${index}-0`, target: `dense-agent-${index - 1}-0`, kind: "communication", evidence: "Fictional successful receipt", lastObservedAt: new Date().toISOString(), eventCount: 50 });
  }
  return { nodes, edges };
}
function Fixture() {
  const [shown, setShown] = useState(true);
  const [data, setData] = useState(new URLSearchParams(location.search).has("empty") ? { nodes: [], edges: [] } as GraphData : new URLSearchParams(location.search).has("dense") ? denseFixture() : fixture);
  const [opened, setOpened] = useState("");
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <nav aria-label="Fixture actions">
      <button onClick={() => setShown((value) => !value)}>Switch view</button>
      <button onClick={() => setData(fixture)}>Load inventory</button>
      <button onClick={() => setData((previous) => ({ nodes: [...previous.nodes, { id: "new-neighbour", kind: "execution", label: "New growth · Codex" }], edges: [...previous.edges, { id: "new-link", source: "new-neighbour", target: "session", kind: "session-execution", evidence: "Recorded session" }] }))}>Add neighbour</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: [...previous.nodes].reverse().map((node) => (node.id === "session" || node.id.startsWith("dense-agent")) ? { ...node, machineId: "south", status: "blocked" } : node) }))}>Live update</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, label: "Review the orchard irrigation schedule and accessibility of the seasonal harvest dashboard", detail: "/fictional/very-long-project-directory/seasonal-orchard-accessibility-review/working-checkout-with-an-unusually-long-name" } : node) }))}>Long labels</button>
      <output aria-label="Opened target">{opened}</output>
    </nav>
    {shown && <GraphView data={data} canOpenNode={(id) => ["session", "execution"].includes(id)} onOpenNode={setOpened} machineNames={new Map([["north", "North garden"], ["south", "South garden"]])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
