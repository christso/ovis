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
    { id: "quay", kind: "terminal", label: "Quay", machineId: "south" },
    { id: "checkout", kind: "terminal", label: "Seedling", status: "blocked", freshness: "live", machineId: "north", detail: "/fictional/orchard/seedling" },
    { id: "session", kind: "terminal", label: "Prune branches", detail: "North garden · feature/irrigation\n/fictional/orchard/seedling", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "terminal", label: "Review branches", status: "working", machineId: "south", freshness: "live" },
    { id: "done", kind: "terminal", label: "Harvest", machineId: "north", status: "done", freshness: "live" },
    { id: "offline", kind: "terminal", label: "Compost", status: "blocked", freshness: "disconnected", machineId: "south" },
  ],
  edges: [
    { id: "harbour-checkout", source: "quay", target: "harbour", kind: "terminal-in-repository", evidence: "Recorded repository: harbour" },
    { id: "a", source: "execution", target: "repo", kind: "terminal-in-repository", evidence: "Recorded checkout: seedling" },
    { id: "b", source: "checkout", target: "repo", kind: "terminal-in-repository", evidence: "Recorded repository: orchard" },
    { id: "c", source: "session", target: "repo", kind: "terminal-in-repository", evidence: "Recorded tab: prune" },
    { id: "d", source: "done", target: "repo", kind: "terminal-in-repository", evidence: "Recorded tab: harvest" },
    { id: "e", source: "offline", target: "harbour", kind: "terminal-in-repository", evidence: "Recorded tab: compost" },
  ],
};
function projectionFixture(): GraphData {
  const now = new Date().toISOString();
  return {
    nodes: [
      { id: "project", kind: "repository", label: "Project" },
      { id: "other-project", kind: "repository", label: "Other project" },
      { id: "notes", kind: "repository", label: "Folder · Notes" },
      ...["main-terminal", "linked-terminal", "notes-terminal", "other-terminal"].map((id) => ({ id, kind: "terminal" as const, label: id, machineId: id.startsWith("other") || id.startsWith("linked") ? "south" : "north", status: "working" as const, freshness: "live" as const, detail: id.startsWith("linked") ? "South garden · feature/review\n/fictional/review" : "North garden · main\n/fictional/project" })),
    ],
    edges: [
      ...[["main-terminal", "project"], ["linked-terminal", "project"], ["other-terminal", "other-project"], ["notes-terminal", "notes"]].map(([source, target]) => ({ id: `parent:${source}`, source: source!, target: target!, kind: "terminal-in-repository" as const, evidence: "Fictional verified Git metadata" })),
      { id: "main-message", source: "main-terminal", target: "other-terminal", kind: "communication", evidence: "codex.communication", eventCount: 2, lastObservedAt: now, sources: ["codex"] },
      { id: "linked-message", source: "linked-terminal", target: "other-terminal", kind: "communication", evidence: "herdr.communication", eventCount: 3, lastObservedAt: now, sources: ["herdr"] },
      { id: "reply", source: "other-terminal", target: "main-terminal", kind: "communication", evidence: "herdr-cli.communication", eventCount: 1, lastObservedAt: now, sources: ["herdr-cli"] },
      { id: "internal", source: "main-terminal", target: "linked-terminal", kind: "communication", evidence: "codex.communication", eventCount: 4, lastObservedAt: now, sources: ["codex"] },
      { id: "launch", source: "main-terminal", target: "other-terminal", kind: "delegation", evidence: "herdr.delegation", eventCount: 1, lastObservedAt: now, sources: ["herdr"] },
    ],
    groups: [{ id: "legacy-project", label: "Project", machineId: "north", nodeIds: ["main-terminal", "linked-terminal"] }],
  };
}
function sizingFixture(): GraphData {
  return {
    nodes: [
      { id: "sizing-hub", kind: "repository", label: "Five-link hub" },
      { id: "sizing-isolated", kind: "repository", label: "No links" },
      ...Array.from({ length: 5 }, (_, index) => ({ id: `sizing-leaf-${index}`, kind: "terminal" as const, label: `Tab ${index + 1}` })),
    ],
    edges: Array.from({ length: 5 }, (_, index) => ({
      id: `sizing-link-${index}`, source: `sizing-leaf-${index}`, target: "sizing-hub",
      kind: "terminal-in-repository" as const, evidence: "Fictional tab membership",
    })),
  };
}
function denseFixture(): GraphData {
  const nodes: GraphData["nodes"][number][] = [], edges: GraphData["edges"][number][] = [];
  const repositories = ["Orchard", "Harbour", "Observatory", "Library", "Meadow"];
  for (const [index, repository] of repositories.entries()) {
    const repo = `dense-repo-${index}`;
    nodes.push({ id: repo, kind: "repository", label: repository, repositoryKey: repository });
    for (let agent = 0; agent < 25; agent++) {
      const id = `dense-agent-${index}-${agent}`;
      nodes.push({ id, kind: "terminal", label: `${repository} task ${agent + 1} · ${agent % 2 ? "Claude" : "Codex"}`, machineId: agent % 2 ? "south" : "north", detail: `${agent % 2 ? "South garden" : "North garden"} · branch/${agent % 4} · /fictional/${repository}`, status: agent % 3 ? "working" : "idle", freshness: "live" });
      edges.push({ id: `checkout-link-${id}`, source: id, target: repo, kind: "terminal-in-repository", evidence: "Fictional execution checkout" });
    }
    if (index) edges.push({ id: `dense-communication-${index}`, source: `dense-agent-${index}-0`, target: `dense-agent-${index - 1}-0`, kind: "communication", evidence: "Fictional successful receipt", lastObservedAt: new Date().toISOString(), eventCount: 50 });
  }
  return { nodes, edges };
}
function Fixture() {
  const [shown, setShown] = useState(true);
  const [data, setData] = useState(new URLSearchParams(location.search).has("empty") ? { nodes: [], edges: [] } as GraphData : new URLSearchParams(location.search).has("projection") ? projectionFixture() : new URLSearchParams(location.search).has("sizing") ? sizingFixture() : new URLSearchParams(location.search).has("dense") ? denseFixture() : fixture);
  const [opened, setOpened] = useState("");
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <nav aria-label="Fixture actions">
      <button onClick={() => setShown((value) => !value)}>Switch view</button>
      <button onClick={() => setData(fixture)}>Load inventory</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, freshness: "disconnected" } : node) }))}>Disconnect source</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, status: "done" } : node) }))}>Finish terminal</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, status: "waiting" } : node) }))}>Background wait</button>
      <button onClick={() => setData((previous) => ({ ...previous, edges: [...previous.edges,
        { id: "message-one", source: "session", target: "execution", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString(), eventCount: 999 },
        { id: "reply-one", source: "execution", target: "session", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
        { id: "message-two", source: "session", target: "offline", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
      ] }))}>Add communication</button>
      <button onClick={() => setData((previous) => ({ nodes: [...previous.nodes, { id: "new-neighbour", kind: "terminal", label: "New growth · Codex", machineId: "north" }], edges: [...previous.edges, { id: "new-link", source: "new-neighbour", target: "repo", kind: "terminal-in-repository", evidence: "Recorded session" }] }))}>Add neighbour</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: [...previous.nodes].reverse().map((node) => (node.id === "session" || node.id.startsWith("dense-agent")) ? { ...node, machineId: "south", status: "blocked" } : node) }))}>Live update</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, label: "Review the orchard irrigation schedule and accessibility of the seasonal harvest dashboard", detail: "/fictional/very-long-project-directory/seasonal-orchard-accessibility-review/working-checkout-with-an-unusually-long-name" } : node) }))}>Long labels</button>
      <output aria-label="Opened target">{opened}</output>
    </nav>
    {shown && <GraphView data={data} canOpenNode={(id) => ["session", "execution", "pane-build", "pane-review"].includes(id)} onOpenNode={setOpened} machineNames={new Map([["north", "North garden"], ["south", "South garden"]])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
