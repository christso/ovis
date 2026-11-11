import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import GraphView from "../src/features/graph/GraphView.tsx";
import type { GraphData } from "../src/features/graph/graphModel.ts";
import { SettingsProvider } from "../src/lib/settings.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "workspace", label: "Orchard", machineId: "north", repositoryKey: "orchard" },
    { id: "harbour", kind: "workspace", label: "Harbour", machineId: "south", repositoryKey: "harbour" },
    { id: "quay", kind: "worktree", label: "Quay", machineId: "south" },
    { id: "checkout", kind: "worktree", label: "Seedling", machineId: "north", detail: "/fictional/orchard/seedling" },
    { id: "session", kind: "tab", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "tab", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "pane-build", kind: "pane", label: "Build shell", status: "working", machineId: "north", freshness: "live" },
    { id: "pane-review", kind: "pane", label: "Review worker", status: "idle", machineId: "north", freshness: "live" },
    { id: "done", kind: "tab", label: "Harvest", machineId: "north", status: "done", freshness: "stale" },
    { id: "offline", kind: "tab", label: "Compost", status: "blocked", freshness: "disconnected", machineId: "south" },
  ],
  edges: [
    { id: "pane-build-parent", source: "pane-build", target: "session", kind: "pane-in-tab", evidence: "Fictional split pane membership" },
    { id: "pane-review-parent", source: "pane-review", target: "session", kind: "pane-in-tab", evidence: "Fictional split pane membership" },
    { id: "harbour-checkout", source: "quay", target: "harbour", kind: "worktree-in-workspace", evidence: "Recorded repository: harbour" },
    { id: "a", source: "execution", target: "checkout", kind: "tab-in-worktree", evidence: "Recorded checkout: seedling" },
    { id: "b", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "Recorded repository: orchard" },
    { id: "c", source: "session", target: "checkout", kind: "tab-in-worktree", evidence: "Recorded tab: prune" },
    { id: "d", source: "done", target: "repo", kind: "tab-in-workspace", evidence: "Recorded tab: harvest" },
    { id: "e", source: "offline", target: "harbour", kind: "tab-in-workspace", evidence: "Recorded tab: compost" },
  ],
};
function sizingFixture(): GraphData {
  return {
    nodes: [
      { id: "sizing-hub", kind: "workspace", label: "Five-link hub" },
      { id: "sizing-isolated", kind: "workspace", label: "No links" },
      ...Array.from({ length: 5 }, (_, index) => ({ id: `sizing-leaf-${index}`, kind: "tab" as const, label: `Tab ${index + 1}` })),
    ],
    edges: Array.from({ length: 5 }, (_, index) => ({
      id: `sizing-link-${index}`, source: `sizing-leaf-${index}`, target: "sizing-hub",
      kind: "tab-in-workspace" as const, evidence: "Fictional tab membership",
    })),
  };
}
function denseFixture(): GraphData {
  const nodes: GraphData["nodes"][number][] = [], edges: GraphData["edges"][number][] = [];
  const repositories = ["Orchard", "Harbour", "Observatory", "Library", "Meadow"];
  for (const [index, repository] of repositories.entries()) {
    const repo = `dense-repo-${index}`;
    nodes.push({ id: repo, kind: "workspace", label: repository, machineId: index % 2 ? "south" : "north", repositoryKey: repository });
    for (let checkout = 0; checkout < 4; checkout++) {
      const id = `dense-checkout-${index}-${checkout}`;
      nodes.push({ id, kind: "worktree", label: `${repository} branch ${checkout + 1}`, machineId: index % 2 ? "south" : "north" });
      edges.push({ id: `repo-link-${id}`, source: id, target: repo, kind: "worktree-in-workspace", evidence: "Fictional native worktree metadata" });
    }
    for (let agent = 0; agent < 25; agent++) {
      const id = `dense-agent-${index}-${agent}`;
      nodes.push({ id, kind: "tab", label: `${repository} task ${agent + 1} · ${agent % 2 ? "Claude" : "Codex"}`, machineId: index % 2 ? "south" : "north", status: agent % 3 ? "working" : "idle", freshness: "live" });
      nodes.push({ id: `pane-${id}`, kind: "pane", label: `${repository} terminal ${agent + 1}`, machineId: index % 2 ? "south" : "north", status: "working", freshness: "live" });
      edges.push({ id: `pane-link-${id}`, source: `pane-${id}`, target: id, kind: "pane-in-tab", evidence: "Fictional split pane membership" });
      edges.push({ id: `checkout-link-${id}`, source: id, target: `dense-checkout-${index}-${agent % 4}`, kind: "tab-in-worktree", evidence: "Fictional execution checkout" });
    }
    if (index) edges.push({ id: `dense-communication-${index}`, source: `dense-agent-${index}-0`, target: `dense-agent-${index - 1}-0`, kind: "communication", evidence: "Fictional successful receipt", lastObservedAt: new Date().toISOString(), eventCount: 50 });
  }
  return { nodes, edges };
}
function Fixture() {
  const [shown, setShown] = useState(true);
  const [data, setData] = useState(new URLSearchParams(location.search).has("empty") ? { nodes: [], edges: [] } as GraphData : new URLSearchParams(location.search).has("sizing") ? sizingFixture() : new URLSearchParams(location.search).has("dense") ? denseFixture() : fixture);
  const [opened, setOpened] = useState("");
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <nav aria-label="Fixture actions">
      <button onClick={() => setShown((value) => !value)}>Switch view</button>
      <button onClick={() => setData(fixture)}>Load inventory</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, freshness: "disconnected" } : node) }))}>Disconnect source</button>
      <button onClick={() => setData((previous) => ({ ...previous, edges: [...previous.edges,
        { id: "message-one", source: "session", target: "execution", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString(), eventCount: 999 },
        { id: "reply-one", source: "execution", target: "session", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
        { id: "message-two", source: "session", target: "offline", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
      ] }))}>Add communication</button>
      <button onClick={() => setData((previous) => ({ nodes: [...previous.nodes, { id: "new-neighbour", kind: "tab", label: "New growth · Codex", machineId: "north" }], edges: [...previous.edges, { id: "new-link", source: "new-neighbour", target: "checkout", kind: "tab-in-worktree", evidence: "Recorded session" }] }))}>Add neighbour</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: [...previous.nodes].reverse().map((node) => (node.id === "session" || node.id.startsWith("dense-agent")) ? { ...node, machineId: "south", status: "blocked" } : node) }))}>Live update</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, label: "Review the orchard irrigation schedule and accessibility of the seasonal harvest dashboard", detail: "/fictional/very-long-project-directory/seasonal-orchard-accessibility-review/working-checkout-with-an-unusually-long-name" } : node) }))}>Long labels</button>
      <output aria-label="Opened target">{opened}</output>
    </nav>
    {shown && <GraphView data={data} canOpenNode={(id) => ["session", "execution", "pane-build", "pane-review"].includes(id)} onOpenNode={setOpened} machineNames={new Map([["north", "North garden"], ["south", "South garden"]])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
