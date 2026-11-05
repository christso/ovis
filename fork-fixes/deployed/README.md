# Installed build: native green recordings

The fork was deployed on 2026-11-05 at [`1b76b353024843301b4f2d9e6266531dad3fa2bf`](https://github.com/christso/ovis/commit/1b76b353024843301b4f2d9e6266531dad3fa2bf). Both recordings below were repeated from that installed checkout after deployment. HTTPS health reports the exact revision, and both served JavaScript entry files match the installed build byte for byte. Configuration, paired-device identities and the existing remote-bundle pin were preserved. The main Herdr socket remained unchanged; only Ovis was restarted. See [deployment verification](deployment-verification.json).

| Case | Previous fork | Installed fork |
| --- | --- | --- |
| Browser clock +2 seconds; initial conversation request held until submit | Transcript message and full faded duplicate | One transcript message and a compact, expandable sent status; no faded duplicate |
| Codex working; queued follow-up; Send now | Delivered follow-up with a generic unconfirmed card | One delivered follow-up; narrower interruption warning, folded saved text, visible recovery actions |

All three fork PRs are now merged into [`christso/main` at `df1c4891`](https://github.com/christso/ovis/commit/df1c489192cb52dea131bc4f206af5862b2e1018). Every required PR check is green. The merged source tree is identical to the installed revision above; HTTPS health and client assets were rechecked after the merges. The running pin remains the tested deployment commit. See [merge and CI verification](merge-verification.json).

## Recordings

- [Green Send now MP4](green-send-now.mp4): native idle control, busy command, queued follow-up, Send now, reload, exact copy, terminal inspection, draft preservation and saved-copy dismissal. [Desktop screenshot](send-now-desktop.png), [phone-width screenshot](send-now-phone-width.png), [results](green-send-now-results.json).
- [Green first-read MP4, touch emulation](green-first-read-touch.mp4): one submit and one actual native user turn, no faded duplicate, one compact status, reload without another submit. [Screenshot](first-read-touch.png), [after reload](first-read-after-reload.png), [three-case results](green-clock-results.json).
- Paired baseline recordings: [first-read red](../red-first-read.mp4), [Send now red](../red-send-now.mp4). The earlier [desktop first-read green](../green-first-read.mp4) used the same clock/request conditions as its baseline.

These runs use Codex 0.166.0 and its real transcript, Herdr 0.9.5, Bun 1.4.3 and Chromium 155. They run in a named isolated check session with temporary server state, a temporary native home and fixture messages. No live user conversation or authentication material is published. The clock experiment explicitly changes browser `Date.now` and delays the initial conversation read; it does not fabricate transcript records or delivery failures. The Send now run injects no fault and only observes the steering helper's actual reads and return. No exact steering panel appeared, so no Escape was sent.

The status remains conservative: acknowledged Enter proves the terminal write; it does not prove immediate native interruption. The native transcript independently contains the follow-up once. Reload retains the saved review copy; copy, terminal inspection and return preserve the draft and produce zero submit/input/keys/pending-action writes. Dismiss removes the saved browser copy without submitting again. The first-read repair changes presentation; correlation and the existing 60-second expiry are unchanged, so the compact status can remain until that expiry.

The first-read recording uses a 390 × 844 mobile/touch browser context. The Send now recording starts at 1280 × 800 and also checks a 390px viewport. These are browser tests, not physical-phone tests. Neither run proves the original user's exact historical timing or remote OMP behavior.

## Change boundaries and checks

- [Fork PR #13](https://github.com/christso/ovis/pull/13): first-read sent-status presentation.
- [Fork PR #14](https://github.com/christso/ovis/pull/14): Send now evidence, recovery copy and controls.
- [Fork PR #15](https://github.com/christso/ovis/pull/15): separate backport of upstream [Settings repair #2651](https://github.com/devswha/ovis/pull/2651), plus existing-tolerance corrections for animated geometry assertions. This addresses the independent Settings failure exposed by the broader browser CI run.

The installed combination passed `bun run check fast`: 10,625 tests, zero failures, 41 repository skips, plus type, build, generated-file and workflow checks. The combined pending-pane, sent-waiting, terminal-peek, composer-fit and native lifecycle browser run passed. The device-security browser matrix passed five desktop/phone, language and theme configurations. All three fork PRs are merged with green Fast checks, Integration and browser, and Native Windows install checks. The initially failed browser jobs passed on retry without further source changes. Completed agent review summaries and finding resolutions were posted before merging; CodeRabbit did not review these fork PRs. Their clean, inactive worktree workspaces and branches were removed. The original upstream receipt draft [#2792](https://github.com/devswha/ovis/pull/2792) remains separate.

## Repeat from an Ovis checkout

Install dependencies and build the client first. A working native Codex login is required. These scripts copy its auth file into a private disposable home and remove that home when finished. They trust only their new temporary working folder, and the fixture command is `sleep 8`.

```sh
OVIS_REPO="$PWD" OVIS_EXPECT_GREEN=1 OVIS_NATIVE_EVIDENCE=/tmp/ovis-send-now-green bun run check run bun /path/to/reproduce-send-now.ts
OVIS_REPO="$PWD" OVIS_EXPECT_GREEN=1 OVIS_MOBILE=1 OVIS_NATIVE_EVIDENCE=/tmp/ovis-clock-green bun run check run bun /path/to/reproduce-clock.ts
```

[Send now harness](reproduce-send-now.ts) · [Clock harness](reproduce-clock.ts) · [SHA-256 manifest](sha256.json).

Recordings are Playwright WebM converted to H.264 MP4 with FFmpeg (`-crf 24 -pix_fmt yuv420p -movflags +faststart`). The clock video retains the original 1280 × 800 recording canvas with the phone viewport fitted inside it. Result summaries omit private runtime paths and reduce wire records to fixture actions and result codes; the observed steering reads remain included.
