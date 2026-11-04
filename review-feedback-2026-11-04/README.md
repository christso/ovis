# Review feedback — 4 November 2026

This records the seven review findings addressed on upstream PRs
[#2717](https://github.com/devswha/ovis/pull/2717),
[#2718](https://github.com/devswha/ovis/pull/2718) and
[#2719](https://github.com/devswha/ovis/pull/2719).
The artifacts remain on the orphan evidence branch, outside the application PRs.

## Waiting baselines

The first test additions fail on the published PR because closed-pane pruning and transcript-reset
invalidation are absent. The fix retains each PC's last accepted connected roster and removes a
baseline only after that pane disappears from a later roster. Disconnected or absent PCs and panes
not yet listed in a cached roster keep their baselines. Herdr retirement clears the roster evidence.
An empty, unread transcript drops only its own old baseline.

The intermediate pruning implementation also failed a new-pane control because it removed
baselines before the cached roster listed their panes. `closed-proof-red.log` records that failure
of the intermediate fix. The final four-file run passes 93 tests with 291 assertions.

## Creation links and visible agent choices

The history regressions fail on the published PR: a held creation entry never opens its dialog,
and Forward can open the remembered local PC instead of the linked remote PC. The final existing
demo scripts pass, covering configured and missing PCs, Back and Forward before the first roster,
and desktop and phone. The missing-PC case also checks that fallback preserves history.

The remote fixture has an agent absent from the local fixture. A negative control that substitutes
local choices for the remote request fails the visible-choice assertion. The final palette script
passes with the remote choices.

The two screenshots show fictional automated demo data. They were opened and inspected and are
not native-agent dogfooding or captures of a live user session. The remote picker assertion and
its negative control are recorded in the logs; the screenshots show the dialog with its picker shut.

## Codex native database identity

Four added cases fail on the published PR. The correction compares resolved `state_5.sqlite`
files by device and inode for the requesting pane, selected home and peer. Shared database aliases
remain competitors. Missing and non-file databases, remote clients and unknown environments also
remain competitors; distinct verified files can be excluded. The changelog no longer says that
unknown stores always leave ownership undecided, since a screen can identify another conversation.

All 152 process tests pass with 463 assertions. They use real owned fixture processes, temporary
stores and synthetic foreground metadata; no model is invoked.

## Verification and conversation completion

`verification-summary.json` records the final fast checks and application commits.
`judgments.json` records the findings and verified reply links. Inline threads are resolved after
reading back the submitted replies; review-summary follow-ups have top-level replies because
GitHub does not offer resolution for those comments.

The full integration/browser suites and native macOS/Windows checks were not run in this pass.
The two targeted browser demo scripts were run in full. Hosted CI remains separate from the local
checks recorded here.

## Advisory check responses

The description check was answered by explicitly naming the existing changelog fragment. The
feature-approval link remains conditional: CONTRIBUTING.md permits a small bug fix directly as a PR.
The requested 80% docstring percentage is not a committed upstream requirement. That warning
was answered with the existing documentation and review-policy context rather than adding comments
that repeat the hook bodies. Both replies were fetched back for verification.
