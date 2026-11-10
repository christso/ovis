/** Independent regression harness for the retained migration dialog; absent from product navigation. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "../shared/machines.ts";
import { graphRegistryInventory } from "../shared/graph-registry-inventory.ts";
import { SettingsProvider } from "../src/lib/settings.ts";
import { useGraphRegistry } from "../src/lib/useGraphRegistry.ts";
import { SessionMoveFixtureControls } from "./session-move-controls-fixture.tsx";
import "../src/styles.css";
function Fixture() {
  const graphRegistry = useGraphRegistry(true);
  const [machines, setMachines] = useState<Machine[]>([]);
  useEffect(() => {
    let stopped = false;
    const read = async () => { const response = await fetch("/api/machines"), value = await response.json(); if (!stopped) setMachines(value.machines); };
    void read(); const timer = window.setInterval(() => void read(), 500);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  const rows = graphRegistry.registry ? graphRegistryInventory(graphRegistry.registry, machines) : [];
  return <SessionMoveFixtureControls registry={graphRegistry.registry} rows={rows} machines={machines} error={graphRegistry.error} refresh={graphRegistry.refresh} onOpenTarget={(target) => { const url = new URL(location.href); url.searchParams.set("machine", target.machine_id); url.searchParams.set("pane", target.pane_id); history.pushState(null, "", url); }} />;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
