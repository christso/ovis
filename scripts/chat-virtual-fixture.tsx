import "../src/styles.css";
import { Profiler, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "../src/components/ChatView.tsx";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";
import { OpenFileContext } from "../src/lib/filePaths.ts";
import { useWaitingSends } from "../src/components/SentWaiting.tsx";
import { rememberWaitingSend, waitingBaseline, waitingKey } from "../src/lib/sentWaiting.ts";
import { capturePendingAttempt } from "../src/lib/pendingTranscript.ts";
import { PendingMessages } from "../src/components/PendingMessages.tsx";
import { PendingMessageStore } from "../src/lib/pendingMessages.ts";
import { paneStorageId } from "../shared/machines.ts";

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
      recovery: (text: string, id?: string, restored?: boolean) => void;
      receipt: (id: string) => void;
    };
  }
}

function SiblingConnection({ connected }: { connected: boolean }) {
  useWaitingSends("local", "sibling-pane", connected);
  return null;
}

const pendingStore = new PendingMessageStore();

function Fixture() {
  const [refresh, setRefresh] = useState(0);
  const [height, setHeight] = useState(window.innerHeight);
  const [width, setWidth] = useState<number | "100%">("100%");
  const [machine, setMachine] = useState("local");
  const [sibling, setSibling] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"working" | "idle">("working");
  const owner = paneStorageId(machine, "same-pane");
  const pending = useSyncExternalStore(pendingStore.subscribe, () => pendingStore.read(owner));
  const [recorded, setRecorded] = useState<readonly string[]>([]);
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
    recovery: (text, id = "review-copy", restored = false) => {
      if (!restored) capturePendingAttempt(waitingKey(machine, "same-pane"), id, text);
      pendingStore.accept(owner, { id, request_id: 1, text, state: "uncertain", created_at: new Date().toISOString(), error: { code: "submit_changed", message: "unknown" } }, restored ? null : "fixture-scope");
    },
    receipt: (id) => pendingStore.publish(owner, [], [{ id, outcome: "sent", resumed: true }], "fixture-scope"),
  };
  return <div className="terminal-host"><div className="terminal-stack is-chat" style={{ position: "relative", height, width }}>
    <MachineContext.Provider value={machine}>
      <Profiler id="chat" onRender={() => window.dispatchEvent(new Event("chat-qa-commit"))}>
        <OpenFileContext.Provider value={() => {}}>
          {/* the metadata of each answer the chat shows: a script can tell an applied answer from one only fetched */}
          <ChatView key={machine} paneId="same-pane" refreshKey={refresh} connected ended={false} agent={null} agentStatus={status} pageScroll={pageScroll}
            pendingRows={pending}
            onPendingMatches={(ids) => setRecorded((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids)}
            onMetadata={(_pane, metadata) => window.dispatchEvent(new CustomEvent("chat-qa-answer", { detail: metadata }))} />
        </OpenFileContext.Provider>
      </Profiler>
    </MachineContext.Provider>
    {pending.length > 0 && <PendingMessages messages={pending} recorded={recorded} connected blocked={false} unsaved={false} isBusy={() => false}
      onSendNow={async () => { throw new Error("An uncertain presentation must never resend"); }} onEdit={async () => { throw new Error("An uncertain presentation must never edit"); }}
      onDiscard={async (id) => pendingStore.publish(owner, [], [{ id, outcome: "discarded", resumed: true }], "fixture-scope")} />}
    {sibling !== null && <SiblingConnection connected={sibling} />}
  </div></div>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Chat fixture root missing");
createRoot(root).render(<SettingsProvider><Fixture /></SettingsProvider>);
