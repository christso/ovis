# Ovis Graph: shared repositories across PCs

[![Watch the updated Graph demo](poster.jpg)](graph-demo.mp4)

[Download the MP4](graph-demo.mp4) · [Captions](captions.vtt)

The actual Ovis App and production graph/registry code show ten fictional terminals under three repository hubs shared across Studio and Laptop. Blue marks working terminals, green marks done, and red marks a request for user input. The compact Repository and Terminal legend stays visible throughout.

The recording follows shared project context, terminal status, directed communication/delegation, an injected waiting → working → done transition, machine clouds, repository-level relationship projection and search. The initial graph contains eight directed communication relationships and three delegation relationships, backed by fifteen synthetic receipt fixtures. Hiding terminals leaves three directed inter-repository communication relationships; same-repository links collapse away.

## Recording

- Source: [`147ff722954bbbdce4ea00e0eb349e6217f4d9b5`](https://github.com/christso/ovis/commit/147ff722954bbbdce4ea00e0eb349e6217f4d9b5), the always-visible legend follow-up to [#52](https://github.com/christso/ovis/pull/52). The captured source checkout was clean.
- 70.60 seconds · 1920 × 1080 · 30 fps · H.264 / yuv420p · fast-start MP4 · no audio.
- File size: 3,164,414 bytes.
- SHA-256: `5fa1e676a251e3476491a680ae5125d93f8f88c9aece9a501cb845a4804f7614`.
- Real React App, GraphView and GraphRegistryStore; fictional two-PC roster, local Git evidence and synthetic native coordination receipts. Fixture identities, status changes and browser actions are automated. The footer identifies fixture data throughout. Only the pointer indicator and caption footer are added for capture.
- No user session, private project, credential or transcript was recorded. The capture ran against a private loopback fixture server and a fresh browser context; both were closed after capture.
- This clip demonstrates the UI and its fixture-backed evidence projection. It does not demonstrate live agents, network communication or native mobile-device interaction. The earlier [65-second real-agent demo](https://raw.githubusercontent.com/christso/ovis/87e0b5b8dc368a0afa12eac71e928b2e0a37b397/graph-demo.mp4) remains available with its [recording notes](https://github.com/christso/ovis/tree/87e0b5b8dc368a0afa12eac71e928b2e0a37b397).

## Verification

Capture assertions checked three shared repositories, ten terminals, three delegations, directed communication, status transitions, two machine clouds, projected repository links, search context and the always-visible legend. There were no browser page errors.

The source passed `CI=1 UNIT_TEST_WORKERS=4 bun run check fast` as `runner` in `herdr-ci-runner:local`: 16,499 unit passes, zero failures, 59 platform/capability skips across 954 files. Generation, typecheck, build and workflow syntax passed. All three graph browser scripts passed in that image, including all ten desktop/phone/theme App contexts. Unrelated full integration/browser lanes and native Windows/macOS checks were not run locally for this UI-only follow-up. The bounded code review completed with no findings.

The exported MP4 was checked for codec, dimensions, duration, compatible pixel format, fast-start metadata and hash. Chapter frames, captions, the refined machine/repository scenes and the final exported footage were reviewed. Full desktop Chrome playback reached the end without an error and decoded 2,118 frames. See [proof.json](proof.json) for scene counts and playback results.

This evidence branch is separate from application history. Its preceding asset revision preserves the original real-agent demonstration.
