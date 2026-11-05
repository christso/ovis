# Uncertain Send now: one message and an attached warning

The fork now places uncertain-send recovery under a unique native transcript turn. It keeps the full saved text collapsed. When placement cannot be established, including after reload, the recovery copy stays compact above the composer. Matching does not confirm delivery, resend input or release the server queue.

- [Before MP4: full duplicate and generic uncertainty card](before/reproduction.mp4)
- [After MP4: inline status, recovery actions and compact reload](after/green.mp4)
- [Before screenshot](before/duplicate.png)
- [After desktop screenshot](after/send-now-inline.png)
- [After phone screenshot](after/inline-phone.png)
- [Compact notice after reload](after/recovery-mobile.png)
- [Green measured results](after/results.json)
- [Source, checks and artifact hashes](manifest.json)
- [Native test harness](reproduce.ts)

## Deployed source verified

The installed source at `de7ba960a5293bda67289f357476ac924ebfe69d` passed the same native smoke test after deployment. [Installed-source green MP4](deployed/green.mp4), [results](deployed/results.json), [phone screenshot](deployed/inline-phone.png), and [HTTPS/deployment verification](deployed/deployment-verification.json). The served client matches the installed build; configuration, device identities, bundle pin and Herdr socket were preserved. Merge remains gated on hosted CI.

## What the recordings establish

These are isolated native Codex sessions, not recordings of a live user chat. Codex performs a short shell tool call; a follow-up is queued and sent with Send now. Native conversation responses are not fixtures. The harness deliberately projects `codex_interrupt_unconfirmed` as generic `submit_changed` in browser-bound WebSocket frames to exercise the generic uncertainty presentation reported by the user. Terminal input and native transcript content are unchanged.

The before run uses the fork base. The after run uses the final implementation before commit; its runtime sources match the commit recorded in the manifest. A documentation clarification followed the recording. This is controlled compatibility coverage, not proof of the exact acknowledgement failure on the user's remote host.

Both green Send now attempts have exactly one browser submit and one corresponding native user turn. The existing uncertain row remains non-resendable. Inline clipboard selection fallback, terminal review, draft preservation, keyboard dismissal and the phone layout pass. Dismissal writes only the discard action and leaves native user-turn counts unchanged. After reload the saved copy remains folded; copy and terminal review issue no new input.

The browser fixture matrix also covers old identical text, competing attempts, different PC namespaces, changed history, reload without a baseline, virtualization and deferred relocation while focus/disclosure engages the recovery row. Unit regressions cover ordinary confirmed-send reservations before and after settlement and unread older turns with coarse timestamps. The independent closure review found no remaining concrete defect.

## Reproduce

From an Ovis checkout with dependencies and native Codex credentials installed:

```sh
OVIS_REPO="$PWD" OVIS_EXPECT_GREEN=1 OVIS_NATIVE_EVIDENCE=/tmp/uncertain-green bun run check run --build bun /path/to/reproduce.ts
```

The check runner creates an isolated Herdr test session. The harness creates temporary Codex configuration, state and workspace directories, records fixture prompts only, then closes its owned workspace. It does not control existing user panes. The generic-code projection is explicitly labelled in each result. MP4s are H.264 conversions of Playwright WebM recordings using CRF 24, yuv420p and faststart.
