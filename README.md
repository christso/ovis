# Temporary duplicate message: browser evidence

This orphan branch contains investigation artifacts only. It changes no Ovis source and is not part of upstream PR #2792.

**Follow-up: [native Codex dogfooding and UX findings](native-dogfood/README.md).** The newer runs use actual native transcripts and no forced transport failures. They reproduce the Send now warning in four fresh sessions and the faded placeholder under a simulated browser-clock/first-read condition. The sections below preserve the earlier controlled demo and acknowledgement-fault experiments.

## What is reproduced

The real Ovis client displays one native transcript bubble together with its faded, clock-marked waiting placeholder. The placeholder later disappears while the transcript message remains. The recording contains one submit, not a repeated send.

This is a **controlled reproduction**, using Ovis's existing demo transport. It does not establish the exact sequence in the user's original browser. In particular, the first-read hold and timestamp offset described below are deliberately staged. No real agent was prompted and no live user session was recorded.

- [Full MP4: duplicate appears, clock appears, duplicate disappears](idle-first-read-clock-skew/reproduction.mp4)
- [Duplicate screenshot](idle-first-read-clock-skew/duplicate.png)
- [Final screenshot, after the duplicate disappears](idle-first-read-clock-skew/final.png)
- [Normal idle-send control](idle-loaded/control.mp4)
- [First-read hold with aligned clocks control](idle-first-read-accurate/control.mp4)
- [Frame counts and timings](results.json)
- [Reproduction script](reproduce.ts)

## Conditions and results

The selected agent is idle OMP. The message is sent through the app's actual composer. The client code is unmodified. Only the demo transport is wrapped to hold its first conversation read and adjust this message's returned transcript timestamp.

| Case | Initial conversation read | Transcript timestamp | Submits | Result |
| --- | --- | --- | --- | --- |
| Normal idle send | Completed before send | Browser send time | 1 | One transcript bubble; no duplicate frame observed |
| First-read control | Held until after send | Browser send time | 1 | One transcript bubble; no duplicate frame observed |
| Reproduction | Held until after send | 150 ms before browser send time | 1 | One transcript bubble plus one faded placeholder for approximately 59.6 seconds; then only the transcript bubble |

The reproduction video is approximately 64 seconds long, recorded in Chromium at 1280 x 800 and converted to H.264 MP4. RequestAnimationFrame samples count transcript and waiting rows independently. All three cases completed without page errors. These are single trials, not a reliability estimate or a long soak.

## Mechanism established by this reproduction

`src/lib/sentWaiting.ts` tracks a confirmed send until a matching user turn is read. If no initial transcript baseline exists, `newerThanSend` requires a precise timestamp to be at least the browser's send time. Its special allowance for whole-second timestamps does not apply here. A transcript timestamp 150 ms earlier therefore fails to settle the placeholder, even while that user turn is visible. The placeholder gets a clock after five seconds and expires after 60 seconds from the send.

The matching and expiry logic, `SentWaitingList`, and its ChatView integration are present in upstream before PR #2792 and unchanged by that PR. A related historical upstream issue, [#2334](https://github.com/devswha/ovis/issues/2334), concerned whole-second timestamps; this reproduction uses a precise timestamp and is not a claim that the historical fix regressed.

The live report's private logs also contain a timing discrepancy: its transcript entry is timestamped 91 ms before its browser's send trace. That supports investigating clock differences, but does not prove that the browser had no baseline. The original browser's baseline and in-memory waiting record were not captured, so its exact trigger remains unconfirmed. Its duration was initially estimated around a minute and later described as possibly shorter.

## Separate local 'Not confirmed' report

The user also reported a separate card above the composer labelled `Not confirmed. Check the terminal before sending again.`, while its message had reached the native conversation. The user confirmed that it was a separate card rather than retained composer text. This is the `PendingMessages` uncertainty presentation, distinct from the faded waiting bubble above.

- [MP4: delivered Enter followed by an uncertain saved card](local-uncertain-card/uncertain-after-enter.mp4)
- [Screenshot](local-uncertain-card/uncertain-delivered.png)
- [Measured result](local-uncertain-card/result.json)
- [Reproduction script](local-uncertain-card/reproduce.ts)

The second recording uses the real Ovis server, browser UI, and an isolated herdr session with a recorder process standing in for Codex. The page receives one synthetic transcript user turn after the recorder observes Enter. The bridge's real `paneSendKeys` runs successfully; the harness then deliberately waits 2 seconds and raises an acknowledgement error. The observed bridge states are `queued -> sending -> uncertain`, with `error.code=submit_changed`. The UI displays the reported warning card alongside the transcript bubble. There is exactly one browser submit, one Enter write, and 45 recorded terminal bytes; no Send now action is offered on the uncertain card. No browser errors occurred. The recorder is not a native Codex agent, and the transcript response is a fixture.

**This is fault injection, not proof of the historical live failure.** The successful browser attempt required correcting the harness's setup: its first two attempts disabled machine management and stopped before input-ready, without submitting a message. No application source was changed to fix that setup.

This path is present before PR #2792: after input starts writing, a failure can retain a pending row as uncertain even if Enter already reached the terminal (`server/core/pending.ts`, dispatch and settlement). It is a delivery-acknowledgement uncertainty, not proof of another send. Codex's post-Enter steering confirmation and ownership suspension after a disconnect are other code paths that can leave uncertainty; the existing diagnostic trace cannot distinguish them for the reported card.

A subsequent delivered local message's private browser diagnostics show a submit result marked `refused` about 2.003 seconds after submission. The trace omits the error code, request type, and pending row ID. That duration alone does not prove a timeout or identify the acknowledgement that failed. The earlier message about recording an MP4 is absent from the retained trace, so the later request must not automatically be attributed to that earlier card. Pinning down the live trigger requires its pending row ID, request_id, error.code and ownership state plus the matching WS result.

The existing pendingMessages, machineSession, pending-input and codex-steering unit suites passed (156 tests, zero failures). The second browser probe also passed through the isolated `bun run check run` harness. No private conversation export, raw diagnostic log, access credential, live machine identifier, or screenshot of the live chat is published here.

## Revisions and reproduction

- Recorded client source: `62db905689ef32ee8fc883c78e3b110838835a5b` (PR #2792).
- Upstream base: `b2d9e5d7074281437dce06ec0890d6f49e80e4df`.
- Live installation inspected: fork revision `4fda6ca101b0209c83bbc8f1a71dd025ebb0fbc9`.
- Toolchain: Bun 1.4.3, Chromium from `/opt/google/chrome/chrome`, Playwright Core, FFmpeg.

From an Ovis checkout with dependencies installed:

```sh
OVIS_REPO="$PWD" OVIS_EVIDENCE_DIR=/tmp/ovis-shadow-browser-evidence bun /path/to/reproduce.ts
```

The main `reproduce.ts` script builds the demo client into a temporary output directory, serves only loopback on an automatically chosen port, records three browser runs, and writes screenshots and results. Its original video output is WebM; the MP4 files here were converted with:

```sh
ffmpeg -i input.webm -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart output.mp4
```

To run the separate pending-card probe from an Ovis checkout, build the app first, then use `bun run check run bun /path/to/local-uncertain-card/reproduce.ts`. It uses only an isolated test session and its own temporary state.

No application fix, version bump, deployment, or change to PR #2792 is included.
