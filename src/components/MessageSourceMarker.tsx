import { messageSourceLabel } from "../../shared/message-source.ts";
import { Fragment, useContext, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { MessageSender } from "../../shared/message-source.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { AgentMark } from "./AgentMark.tsx";
import { MessageSourceContext } from "../lib/messageSourceContext.tsx";

export function MessageSourceMarker({ sender }: { sender: MessageSender }) {
  const t = useT(), machine = useMachineId();
  const open = useContext(MessageSourceContext);
  const [state, setState] = useState<"idle" | "opening" | "unavailable">("idle");
  const name = messageSourceLabel(sender.name);
  return <div className="chat-peer-source">
    <span className="chat-peer-label">{t("Message from {name}", { name: "\u0000" }).split("\u0000").map((text, index) => <Fragment key={index}>
      {index > 0 && <span className="chat-peer-name">{sender.agent && <AgentMark agent={sender.agent} size={14} />}{name}</span>}
      {text}
    </Fragment>)}</span>
    {open && <button type="button" className="chat-meta-btn" disabled={state === "opening"} onClick={() => {
      setState("opening");
      void open(machine, sender.id).then((ok) => setState(ok ? "idle" : "unavailable"), () => setState("unavailable"));
    }} aria-label={t("Open message source")} title={t("Open message source")}><ArrowUpRight aria-hidden="true" /></button>}
    {state === "unavailable" && <span role="status">{t("Message source is unavailable")}</span>}
  </div>;
}
