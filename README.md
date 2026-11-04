# Small upstream bug fixes — 4 November 2026

These artifacts accompany independent bug-fix PRs based on upstream commit
`74dfea3e72de1f26a07e9028aef77d8f77396e67`.
This branch has no application-history parent and is not intended for merging.

All browser captures use fictional automated fixtures. They are reproduction evidence,
not screenshots from native-agent dogfooding or a live user session.

## Waiting bubble after a sibling disconnect

A disconnected sibling clears another pane's loaded transcript baseline. If the browser
clock is ahead of the PC, the waiting copy can remain beside the transcript turn.

The mounted regression fails before the fix and passes after it. The four affected test
files pass together: 90 tests. `bun run check fast` passes: 10,938 tests, zero failures,
42 skips, plus typecheck, build, workflow syntax and generated-file checks.

The browser fixture compares current upstream's `SentWaiting.tsx` with the fixed component
using the same fictional ChatView, at 390px and 1280px. With a disconnected sibling and
2,000ms browser-clock offset, upstream retains one waiting copy; the fixed component
retains none. The earlier message and recorded follow-up remain visible.

See [screenshots](waiting-baseline/screenshots), [upstream counts](waiting-baseline/upstream-main-74dfea3e.json)
and [fixed counts](waiting-baseline/waiting-baseline-fixed.json).

`waiting-baseline/reproduce.ts` can be run from the waiting-fix checkout with Bun and its
installed dependencies. Run once normally, then with `--upstream`. It loads the fixture
from public fork commit `6e09c56e` and compares upstream component commit `74dfea3e`.
Those objects must be available locally. The fixture's extra controls mount a sibling and
record a fictional send; this is a component reproduction, not a full upstream deployment.

## Separate Codex stores in the same directory

The test uses real owned fixture processes, temporary native stores and synthetic foreground
metadata; no Codex model is invoked. Two distinct-store cases fail before the fix.
Five conservative controls pass, including same-store aliases and unknown environments.
After the fix, all 148 tests in `server/codex-processes.test.ts` pass.
See the [process-test record](codex-store-peers/README.md), including the initial upstream
failure, remote-client review finding, and final 148 passing tests.

## Creation link selects its named PC

The existing fictional app demos reproduce a remote creation link opening Laptop's dialog
instead of Build PC's. A missing-PC creation link also fails its header-note assertion.
Both complete demo scripts pass after the fix, including desktop and phone cases.
See [verification](create-link-selection/verification.md),
[before](create-link-selection/red/creation-link-desktop.png),
[desktop after](create-link-selection/green/creation-link-desktop.png) and
[phone after](create-link-selection/green/creation-link-phone.png).

All three final fast checks passed, including typecheck, build, workflow syntax and generated-file
freshness. Unit counts were 10,938 for waiting bubbles, 10,947 for separate Codex stores, and
10,936 for creation links; each had zero failures and 42 skips.

Native macOS and Windows checks have not been run locally. Application PRs carry their
regression tests and changelog fragments; this branch holds screenshots and supporting output.
