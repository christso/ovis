# Message source links

When several agents work together, an incoming update can look like an ordinary user message. You lose the sender's identity and have to search terminals to find the agent behind it.

This prototype adds a sender label to received peer messages and an action that opens the source terminal.

[Watch or download the 28-second MP4](./message-source-demo.mp4)

![A received message identifies its source terminal and offers a source action](./poster.jpg)

## What the demo shows

1. Release coordinator waits for Graph worktree projection to verify the hierarchy and filters.
2. The received report says “Message from”, followed by the source agent icon, “Graph worktree projection” and a source arrow.
3. Clicking the arrow opens the source terminal. Its Chat view identifies the original request as “Message from [omp icon] Release coordinator”.
4. Clicking that request’s source action returns to the coordinator.
5. The same sender labels and source action work in a 390 px touch viewport.

[Desktop screenshot](./desktop.png) · [Mobile screenshot](./mobile.png) · [Worker’s request with its coordinator source](./worker-request.png) · [Mobile video frame](./mobile-poster.jpg) · [Captions](./captions.vtt)

## Recording setup

Recorded from [christso/ovis PR #49](https://github.com/christso/ovis/pull/49), final revision `e4517cee6afd1813f9d0b96b3609fdd54fd42a11`. The capture used `b7deeb208c71d420ddc683c5af2327eb11980d56`; the final revision differs only in a legacy test’s TypeScript assertion. All production source is unchanged.

This is an isolated browser demo with **fictional agent traffic**, not a recording of live agents. The unmodified Ovis client renders the messages and handles the source action. Production message-source functions prepare, publish and authenticate both the coordinator’s request and the worker’s report before they enter the demo. Native transcripts, message arrival, terminal output and source-resolution responses come from demo fixtures. The recording does not establish live CLI delivery or daemon identity checks.

Playwright operates desktop Chrome and a phone-sized touch browser. This is browser emulation, not a physical phone recording. The visible cursor and tap cue follow the automated interactions. Captions sit below the application; the phone scenes add explanatory text beside its viewport.

No user panes, credentials or private conversations were captured. No production service was changed.

## Verification

Both capture runs asserted that both received messages carry sender attribution, and that the report’s source action selects Graph worktree projection in Terminal view before its Chat conversation opens. The desktop run also clicked the original request’s source action and verified the return to Release coordinator. The fixture recorded zero terminal input submissions or Herdr focus calls, no horizontal page overflow and no browser errors. Source resolution ran again after the machine roster refreshed.

The exported MP4 played to completion at normal speed in Chrome. Its desktop and mobile scenes were visually reviewed. It is 1920 × 1080, 30 fps, H.264/yuv420p, with fast-start metadata and no audio. [proof.json](./proof.json) contains the revision, file hash, chapter times and checks.

This evidence run changed no implementation files. It ran the capture's focused assertions and exported-video playback check; it did not repeat the implementation's full unit, integration or native-platform suites. Live agent delivery, physical-device behavior and unavailable/replaced sources were not exercised in this clip.

This orphan branch contains demo artifacts only. The implementation remains separate in PR #49.
