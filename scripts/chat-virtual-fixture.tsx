import "../src/styles.css";
import { Profiler, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../src/components/ChatView.tsx";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { OpenFileContext } from "../src/lib/filePaths.ts";
import { useWaitingSends } from "../src/components/SentWaiting.tsx";
import { paneLifetimes } from "../src/lib/paneLifetime.ts";
import { rememberWaitingSend, waitingBaseline, waitingKey } from "../src/lib/sentWaiting.ts";

declare global {
  interface Window {
    chatQa: {
      refresh: () => void;
      page: (direction: -1 | 1) => void;
      /** the chat's height, and its width (a split pane's) when given */
      resize: (height: number, width?: number) => void;
      machine: (machine: string) => void;
      siblingConnection: (connected: boolean | null) => void;
      send: (text: string) => void;
      /** the agent's status: a working one's follow glides */
      status: (status: "working" | "idle") => void;
    };
  }
}

paneLifetimes.observe([{ id: "local", snapshot: { herdr_lifetime: "chat-fixture-herdr", protocol: 22, version: "fixture", panes: [], tabs: [], workspaces: [], layouts: [], agents: [] } }]);

function SiblingConnection({ connected }: { connected: boolean }) {
  useWaitingSends("local", "sibling-pane", connected);
  return null;
}

function Fixture() {
  const [refresh, setRefresh] = useState(0);
  const [height, setHeight] = useState(window.innerHeight);
  const [width, setWidth] = useState<number | "100%">("100%");
  const [machine, setMachine] = useState("local");
  const [sibling, setSibling] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"working" | "idle">("working");
  const pageScroll = useRef<((direction: -1 | 1) => void) | null>(null);
  window.chatQa = {
    refresh: () => setRefresh((value) => value + 1),
    page: (direction) => pageScroll.current?.(direction),
    resize: (height, width) => { setHeight(height); if (width !== undefined) setWidth(width); },
    machine: setMachine,
    siblingConnection: setSibling,
    send: (text) => {
      const key = waitingKey(machine, "same-pane");
      rememberWaitingSend(key, text, Date.now(), waitingBaseline(key));
    },
    status: setStatus,
  };
  return <div className="terminal-host"><div className="terminal-stack is-chat" style={{ position: "relative", height, width }}>
    <MachineContext.Provider value={machine}>
      <Profiler id="chat" onRender={() => window.dispatchEvent(new Event("chat-qa-commit"))}>
        <OpenFileContext.Provider value={() => {}}>
          {/* the metadata of each answer the chat shows: a script can tell an applied answer from one only fetched */}
          <ChatView key={machine} paneId="same-pane" refreshKey={refresh} connected ended={false} agent={null} agentStatus={status} pageScroll={pageScroll}
            onMetadata={(_pane, metadata) => window.dispatchEvent(new CustomEvent("chat-qa-answer", { detail: metadata }))} />
        </OpenFileContext.Provider>
      </Profiler>
    </MachineContext.Provider>
    {sibling !== null && <SiblingConnection connected={sibling} />}
  </div></div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Chat fixture root missing");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
