import { messageSourceLabel } from "../../shared/message-source.ts";
import { useContext, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { MessageSender } from "../../shared/message-source.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { MessageSourceContext } from "../lib/messageSourceContext.tsx";

export function MessageSourceMarker({ sender }: { sender: MessageSender }) {
  const t = useT(), machine = useMachineId();
  const open = useContext(MessageSourceContext);
  const [state, setState] = useState<"idle" | "opening" | "unavailable">("idle");
  const name = messageSourceLabel(sender.name);
  return <div className="chat-peer-source">
    <span>{t("Peer content from {name}", { name })}</span>
    {open && <button type="button" className="chat-meta-btn" disabled={state === "opening"} onClick={() => {
      setState("opening");
      void open(machine, sender.id).then((ok) => setState(ok ? "idle" : "unavailable"), () => setState("unavailable"));
    }} aria-label={t("Open message source")} title={t("Open message source")}><ArrowUpRight aria-hidden="true" /></button>}
    {state === "unavailable" && <span role="status">{t("Message source is unavailable")}</span>}
  </div>;
}
