import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import GraphView from "../src/features/graph/GraphView.tsx";
import type { GraphData } from "../src/features/graph/graphModel.ts";
import { SettingsProvider } from "../src/lib/settings.ts";

const fixture: GraphData = {
  nodes: [
    { id: "repo", kind: "workspace", label: "Orchard", status: "done", hasWorkingTerminals: true, freshness: "live", machineId: "north", repositoryKey: "orchard" },
    { id: "harbour", kind: "workspace", label: "Harbour", machineId: "south", repositoryKey: "harbour" },
    { id: "quay", kind: "worktree", label: "Quay", machineId: "south" },
    { id: "checkout", kind: "worktree", label: "Seedling", status: "blocked", hasWorkingTerminals: true, freshness: "live", machineId: "north", detail: "/fictional/orchard/seedling" },
    { id: "session", kind: "terminal", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "execution", kind: "terminal", label: "Prune branches", status: "working", machineId: "north", freshness: "live" },
    { id: "done", kind: "terminal", label: "Harvest", machineId: "north", status: "done", freshness: "stale" },
    { id: "offline", kind: "terminal", label: "Compost", status: "blocked", freshness: "disconnected", machineId: "south" },
  ],
  edges: [
    { id: "harbour-checkout", source: "quay", target: "harbour", kind: "worktree-in-workspace", evidence: "Recorded repository: harbour" },
    { id: "a", source: "execution", target: "checkout", kind: "terminal-in-worktree", evidence: "Recorded checkout: seedling" },
    { id: "b", source: "checkout", target: "repo", kind: "worktree-in-workspace", evidence: "Recorded repository: orchard" },
    { id: "c", source: "session", target: "checkout", kind: "terminal-in-worktree", evidence: "Recorded tab: prune" },
    { id: "d", source: "done", target: "repo", kind: "terminal-in-workspace", evidence: "Recorded tab: harvest" },
    { id: "e", source: "offline", target: "harbour", kind: "terminal-in-workspace", evidence: "Recorded tab: compost" },
  ],
};
function projectionFixture(): GraphData {
  const now = new Date().toISOString();
  return {
    nodes: [
      { id: "project", kind: "workspace", label: "Project", machineId: "north", status: "done", hasWorkingTerminals: true, freshness: "live" },
      { id: "other-project", kind: "workspace", label: "Other project", machineId: "south" },
      { id: "notes", kind: "workspace", label: "Plain notes", machineId: "north" },
      { id: "main-checkout", kind: "worktree", label: "Main checkout", machineId: "north", hasWorkingTerminals: true, freshness: "live", detail: "/fictional/project · release" },
      { id: "linked-checkout", kind: "worktree", label: "Feature checkout", machineId: "north" },
      { id: "other-checkout", kind: "worktree", label: "Other checkout", machineId: "south" },
      { id: "orphan", kind: "worktree", label: "Orphan", machineId: "south" },
      ...["main-terminal", "linked-terminal", "notes-terminal", "other-terminal", "orphan-terminal"].map((id) => ({ id, kind: "terminal" as const, label: id, machineId: id.startsWith("other") || id.startsWith("orphan") ? "south" : "north", status: "working" as const, freshness: "live" as const })),
    ],
    edges: [
      ...[["main-checkout", "project"], ["linked-checkout", "project"], ["other-checkout", "other-project"]].map(([source, target]) => ({ id: `parent:${source}`, source: source!, target: target!, kind: "worktree-in-workspace" as const, evidence: "Fictional Herdr metadata" })),
      ...[["main-terminal", "main-checkout"], ["linked-terminal", "linked-checkout"], ["other-terminal", "other-checkout"], ["orphan-terminal", "orphan"]].map(([source, target]) => ({ id: `parent:${source}`, source: source!, target: target!, kind: "terminal-in-worktree" as const, evidence: "Fictional Herdr metadata" })),
      { id: "parent:notes", source: "notes-terminal", target: "notes", kind: "terminal-in-workspace", evidence: "Fictional folder membership" },
      { id: "main-message", source: "main-terminal", target: "other-terminal", kind: "communication", evidence: "codex.communication", eventCount: 2, lastObservedAt: now, sources: ["codex"] },
      { id: "linked-message", source: "linked-terminal", target: "other-terminal", kind: "communication", evidence: "herdr.communication", eventCount: 3, lastObservedAt: now, sources: ["herdr"] },
      { id: "reply", source: "other-terminal", target: "main-terminal", kind: "communication", evidence: "herdr-cli.communication", eventCount: 1, lastObservedAt: now, sources: ["herdr-cli"] },
      { id: "internal", source: "main-terminal", target: "linked-terminal", kind: "communication", evidence: "codex.communication", eventCount: 4, lastObservedAt: now, sources: ["codex"] },
      { id: "notes-message", source: "other-terminal", target: "notes-terminal", kind: "communication", evidence: "codex.communication", eventCount: 6, lastObservedAt: now, sources: ["codex"] },
      { id: "orphan-message", source: "orphan-terminal", target: "other-terminal", kind: "communication", evidence: "herdr.communication", eventCount: 7, lastObservedAt: now, sources: ["herdr"] },
      { id: "launch", source: "main-terminal", target: "other-terminal", kind: "delegation", evidence: "herdr.delegation", eventCount: 1, lastObservedAt: now, sources: ["herdr"] },
    ],
    groups: [{ id: "legacy-project", label: "Project", machineId: "north", nodeIds: ["project", "main-checkout", "linked-checkout", "main-terminal", "linked-terminal"] }],
  };
}
function sizingFixture(): GraphData {
  return {
    nodes: [
      { id: "sizing-hub", kind: "workspace", label: "Five-link hub" },
      { id: "sizing-isolated", kind: "workspace", label: "No links" },
      ...Array.from({ length: 5 }, (_, index) => ({ id: `sizing-leaf-${index}`, kind: "terminal" as const, label: `Tab ${index + 1}` })),
    ],
    edges: Array.from({ length: 5 }, (_, index) => ({
      id: `sizing-link-${index}`, source: `sizing-leaf-${index}`, target: "sizing-hub",
      kind: "terminal-in-workspace" as const, evidence: "Fictional tab membership",
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
      nodes.push({ id, kind: "terminal", label: `${repository} task ${agent + 1} · ${agent % 2 ? "Claude" : "Codex"}`, machineId: index % 2 ? "south" : "north", status: agent % 3 ? "working" : "idle", freshness: "live" });
      edges.push({ id: `checkout-link-${id}`, source: id, target: `dense-checkout-${index}-${agent % 4}`, kind: "terminal-in-worktree", evidence: "Fictional execution checkout" });
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
      <button onClick={() => setData((previous) => ({ ...previous, edges: [...previous.edges,
        { id: "message-one", source: "session", target: "execution", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString(), eventCount: 999 },
        { id: "reply-one", source: "execution", target: "session", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
        { id: "message-two", source: "session", target: "offline", kind: "communication", evidence: "Fictional receipt", lastObservedAt: new Date().toISOString() },
      ] }))}>Add communication</button>
      <button onClick={() => setData((previous) => ({ nodes: [...previous.nodes, { id: "new-neighbour", kind: "terminal", label: "New growth · Codex", machineId: "north" }], edges: [...previous.edges, { id: "new-link", source: "new-neighbour", target: "checkout", kind: "terminal-in-worktree", evidence: "Recorded session" }] }))}>Add neighbour</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: [...previous.nodes].reverse().map((node) => (node.id === "session" || node.id.startsWith("dense-agent")) ? { ...node, machineId: "south", status: "blocked" } : node) }))}>Live update</button>
      <button onClick={() => setData((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === "session" ? { ...node, label: "Review the orchard irrigation schedule and accessibility of the seasonal harvest dashboard", detail: "/fictional/very-long-project-directory/seasonal-orchard-accessibility-review/working-checkout-with-an-unusually-long-name" } : node) }))}>Long labels</button>
      <output aria-label="Opened target">{opened}</output>
    </nav>
    {shown && <GraphView data={data} canOpenNode={(id) => ["session", "execution", "pane-build", "pane-review"].includes(id)} onOpenNode={setOpened} machineNames={new Map([["north", "North garden"], ["south", "South garden"]])} />}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
