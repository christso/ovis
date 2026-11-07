import { expect, it, spyOn } from "bun:test";
import * as launch from "../agent-launch.ts";
import { moveRuntime } from "./runtime.ts";

it("passes the confirmed destination checkout to the existing native Codex resume launch", async () => {
  const started = spyOn(launch, "agentLaunch").mockResolvedValue({ agent_started: true } as Awaited<ReturnType<typeof launch.agentLaunch>>);
  try {
    const runtime = moveRuntime(async () => { throw new Error("Owned start-only fixture never reads Herdr"); });
    await runtime.start("owned:p0", "00000000-0000-4000-8000-000000000020", "/owned/relocated-checkout");
    expect(started).toHaveBeenCalledWith("owned:p0", { kind: "codex", args: ["resume", "00000000-0000-4000-8000-000000000020", "--cd", "/owned/relocated-checkout"] });
  } finally { started.mockRestore(); }
});
