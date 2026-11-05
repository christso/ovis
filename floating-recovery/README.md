# Floating send recovery

Unconfirmed-send recovery stays in a raised card immediately above the composer, outside transcript scrolling. The original text is folded behind **Saved message**. **Dismiss saved copy** remains reachable; copy and terminal review preserve the draft. Exact scoped sent/discarded receipts remove the card automatically. Equal transcript text does not prove a particular attempt was delivered.

This replaces the earlier [inline recovery presentation](../uncertain-transcript-status/README.md). Its evidence remains preserved as history. The upstream receipt-recovery PR remains separate.

- [Phone screenshot](before-deployment/floating-phone.png)
- [Short phone screenshot, 390 × 470](before-deployment/floating-short-phone.png)
- [Desktop screenshot](before-deployment/floating-desktop.png)
- [Measured native results](before-deployment/results.json)
- [Native reproduction harness](reproduce.ts)

## What was exercised

The harness uses the real client/server and isolated native Codex sessions. Codex runs a short shell tool call; follow-ups go through the actual composer and Send now. Native transcripts are not fixtures. The browser-bound WebSocket deliberately maps `codex_interrupt_unconfirmed` to generic `submit_changed` to exercise the reported generic warning. It does not change input or native transcript content. This is controlled compatibility coverage, not proof of the exact acknowledgement failure on the user’s remote host.

The idle confirmed-send control and both Send now cases each produced one submit and one native user turn. Neither Send now case displayed a faded duplicate. The saved copy stayed folded outside the transcript. Clipboard refusal selected the exact saved text; terminal review preserved the draft and sent no input. Keyboard dismissal wrote only a discard action and left native turns unchanged. A new explicit message after clearing recovery was accepted once. Reload preserved folded recovery and copy/terminal review remained non-sending. The 390 × 470 layout kept delivery status, unblock instructions and Dismiss visible. No page errors occurred.

The committed browser matrix covers matching native text, restored copies, competing attempts, PC namespaces, wrong receipts, exact receipts, transcript virtualization and focus/disclosure preservation. The production PaneTerminal browser suite checks short-phone geometry with Saved message open/closed, denied clipboard paths and keyboard dismissal back to the owning composer.

An additional attempted automatic-queue known-sent native control returned `submit_changed` without a native user turn. It is not counted as confirmation or a green control. Exact receipt cleanup is covered by the browser/store tests and ordinary confirmed native send control.

## Reproduce

From an Ovis checkout with dependencies and native Codex credentials:

```sh
OVIS_REPO="$PWD" OVIS_EXPECT_GREEN=1 OVIS_NATIVE_EVIDENCE=/tmp/floating-green bun run check run --build bun /path/to/reproduce.ts
```

The checker creates an isolated Herdr session. The harness creates temporary Codex configuration, workspace and server state, closes its own workspace, and deletes its temporary state. It never records the user’s live chat. Videos are H.264 MP4 conversions of Playwright recordings using CRF 24, yuv420p and faststart.
