# Codex Send now leaves a duplicate in Ovis Chat

[Red recording](red-before.mp4) and [green recording](green-after.mp4)

Both recordings use the actual Ovis interface in Chromium and Codex CLI 0.171.0 in separate local Herdr test sessions. Browser automation types and clicks through Chat. The clips shorten the wait and crop the local machine and path from the status bar.

## Reproduce

1. Start a Codex turn that keeps a tool running, such as a 25-second shell command.
2. While Codex is working, type one short follow-up in Ovis Chat and click **Send**. Ovis queues the message.
3. Click **Send now** on that queued message.

## What happened

- **Red** (`a89beb31`). Codex accepted the follow-up directly into the active turn. Ovis showed one copy in Chat and kept another above the composer marked **Not confirmed**, including after the turn ended.
- **Green** (`ba8d5155`). The same flow showed one copy in Chat and cleared the queued row.

The underlying Codex rollout recorded one user message in each run. The terminal samples showed the accepted follow-up above the live Working status, without a visible steering panel. The videos show the single-line follow-up case.
