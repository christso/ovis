import "../src/styles.css";
import { Profiler, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../src/components/ChatView.tsx";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { OpenFileContext } from "../src/lib/filePaths.ts";
import { useWaitingSends } from "../src/components/SentWaiting.tsx";
import { rememberWaitingSend, waitingBaseline, waitingKey } from "../src/lib/sentWaiting.ts";
import { PendingMessages } from "../src/components/PendingMessages.tsx";
import type { PendingMessageView } from "../src/lib/pendingMessages.ts";
import { capturePendingAttempt } from "../src/lib/pendingTranscript.ts";

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
      recovery: (text: string, id?: string, capture?: boolean) => void;
    };
  }
}

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
  const [pending, setPending] = useState<PendingMessageView[]>([]);
  const [targets, setTargets] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map());
  const onPendingTarget = useCallback((id: string, target: HTMLElement | null) => setTargets((before) => {
    if (target === null ? !before.has(id) : before.get(id) === target) return before;
    const next = new Map(before);
    if (target === null) next.delete(id); else next.set(id, target);
    return next;
  }), []);
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
    recovery: (text, id = "review-copy", capture = true) => {
      if (capture) capturePendingAttempt(waitingKey(machine, "same-pane"), id, text);
      setPending((before) => [...before, { id, request_id: 1, text, state: "uncertain", created_at: new Date().toISOString(), serverOwned: true, error: { code: "submit_changed", message: "unknown" } }]);
    },
  };
  return <div className="terminal-host"><div className="terminal-stack is-chat" style={{ position: "relative", height, width }}>
    <MachineContext.Provider value={machine}>
      <Profiler id="chat" onRender={() => window.dispatchEvent(new Event("chat-qa-commit"))}>
        <OpenFileContext.Provider value={() => {}}>
          {/* the metadata of each answer the chat shows: a script can tell an applied answer from one only fetched */}
          <ChatView key={machine} paneId="same-pane" refreshKey={refresh} connected ended={false} agent={null} agentStatus={status} pageScroll={pageScroll}
            pendingRows={pending} onPendingTarget={onPendingTarget}
            onMetadata={(_pane, metadata) => window.dispatchEvent(new CustomEvent("chat-qa-answer", { detail: metadata }))} />
        </OpenFileContext.Provider>
      </Profiler>
    </MachineContext.Provider>
    {pending.length > 0 && <PendingMessages messages={pending} connected blocked={false} unsaved={false} isBusy={() => false}
      onSendNow={async () => { throw new Error("An uncertain presentation must never resend"); }} onEdit={async () => { throw new Error("An uncertain presentation must never edit"); }}
      onDiscard={async (id) => setPending((before) => before.filter((row) => row.id !== id))} targetFor={(id) => targets.get(id)} />}
    {sibling !== null && <SiblingConnection connected={sibling} />}
  </div></div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Chat fixture root missing");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
