/** Independent regression harness for the retained migration dialog; absent from product navigation. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "../shared/machines.ts";
import { flockInventory } from "../shared/flock-inventory.ts";
import { SettingsProvider } from "../src/lib/settings.ts";
import { useFlock } from "../src/lib/useFlock.ts";
import { SessionMoveFixtureControls } from "./session-move-controls-fixture.tsx";
import "../src/styles.css";
function Fixture() {
  const flock = useFlock(true);
  const [machines, setMachines] = useState<Machine[]>([]);
  useEffect(() => {
    let stopped = false;
    const read = async () => { const response = await fetch("/api/machines"), value = await response.json(); if (!stopped) setMachines(value.machines); };
    void read(); const timer = window.setInterval(() => void read(), 500);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  const rows = flock.registry ? flockInventory(flock.registry, machines) : [];
  return <SessionMoveFixtureControls registry={flock.registry} rows={rows} machines={machines} error={flock.error} refresh={flock.refresh} onOpenTarget={(target) => { const url = new URL(location.href); url.searchParams.set("machine", target.machine_id); url.searchParams.set("pane", target.pane_id); history.pushState(null, "", url); }} />;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
