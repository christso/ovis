<!-- Generated from status.json by scripts/fork-status.py; edit the JSON or refresh. -->
# Fork comparison

Snapshot: 2026-10-31T09:16:37.736538+00:00. This is a pinned comparison, not live status.

Fork: [christso/ovis](https://github.com/christso/ovis) · ref `HEAD` · commit [`f78083aba289aee1eaaa89f90330a019e53e3584`](https://github.com/christso/ovis/commit/f78083aba289aee1eaaa89f90330a019e53e3584).
Upstream: [devswha/ovis](https://github.com/devswha/ovis) · ref `3c679791` · commit [`3c6797913ce711b5dd870f3016e72ebde95b6a8f`](https://github.com/devswha/ovis/commit/3c6797913ce711b5dd870f3016e72ebde95b6a8f).

Fork ahead / behind upstream: **61 / 0 commits** (full history, before path exclusions).
Upstream is an ancestor of the fork: **yes**. Product files differing: **102**.

## Reporting scope

Exclude the whole English README (including the fork introduction) and the fork reporting files/tool, so reporting does not count itself as product work. All other changed paths, including documentation, tests and changelog fragments, count.

Excluded exact paths:

- `README.md`
- `docs/fork/status.json`
- `docs/fork/status.md`
- `docs/fork/upstream-candidates.md`
- `scripts/fork-status.py`

Method: Git tree diff, no renames; binary numstats are null. Compare the two committed trees directly, not just changes since their merge base. Uncommitted file contents are not compared.

Excluded paths that differ in this snapshot: `README.md`, `docs/fork/status.json`, `docs/fork/status.md`, `scripts/fork-status.py`.

## Retained fork changes

| Area | Type | Difference from pinned upstream | Files | Upstream context |
| --- | --- | --- | ---: | --- |
| OMP custom config roots | Retained functionality | Resolve PI_CONFIG_DIR from the pane's process for default and named profiles, retaining upstream's bounded WSL probes. | 3 | — |
| Codex custom session stores | Retained functionality | Bind chats to the native process's custom store and distinguish peers sharing a working directory. Merged upstream footer fixes are not counted as fork-exclusive functionality. | 5 | PR [#1155](https://github.com/devswha/ovis/pull/1155), PR [#1248](https://github.com/devswha/ovis/pull/1248) |
| Pane and PC navigation | Retained functionality | Keep new worktree and PC selections through roster refreshes, deep links and browser navigation, including worktree-selection regression registration and assertions in the browser lane. | 10 | — |
| Native Working regression and history | Manual regression + historical fragment | scripts/chat-browser-qa.ts retains a manual browser regression. changelog.d/native-working-chat.md is a historical fork fragment, not new functionality or QA coverage. The live Working implementation is already upstream, including the merged OMP fixes. | 2 | PR [#1307](https://github.com/devswha/ovis/pull/1307), PR [#1322](https://github.com/devswha/ovis/pull/1322) |
| Saved launchers and executable search | Retained functionality | Save native agent commands and arguments, validate and search executables on the selected PC, and use launchers in workspace, tab and worktree creation. Earlier profile-picker code has been replaced; its changelog fragment is historical. | 52 | — |
| Exact pending-message receipt recovery | Bug fix and reproduction evidence | Retain and recover exact sent/discarded outcomes after reconnect, including relayed PCs, without resending terminal input. Includes fictional-transcript reproduction evidence and remote bridge deployment requirements. | 21 | — |
| Sent waiting-bubble reconciliation | Bug fix and regression coverage | Preserve loaded transcript baselines during connection cleanup so a disconnected sibling and browser clock skew do not strand a faded duplicate. Full Herdr retirement still clears both baselines and provisional sends. | 7 | — |
| Host-independent installer fixture | Test tooling | Keep the installer fallback test PATH inside its owned fixture instead of inheriting a host Node installation. | 1 | — |
| Shared fork design notes | Documentation | Document fork launcher choices alongside the upstream design. Shared integration files are classified once in their primary area; a file count is not an exclusive ownership claim. | 1 | — |

PR/issue links are historical context, not proof of coverage or current status. See docs/fork/upstream-candidates.md for dogfooding and submission readiness. The comparison applies only to the selected source pins; inclusion and ahead/behind counts are reported above.

Membership uses explicit paths, not filename wildcards. New unmatched paths remain in the complete file table and require classification.

**Unclassified paths: 0.** All changed product paths are accounted for.

## Complete product file detail

`A` = added, `M` = modified, `D` = deleted, `T` = type changed. Renames appear as deletion/addition; binary counts are shown as `binary`.

| File | Git status | Added | Removed | Area |
| --- | --- | ---: | ---: | --- |
| `DESIGN.md` | M | 45 | 0 | shared-design-notes |
| `changelog.d/agent-launch-profiles.md` | A | 9 | 0 | saved-launchers |
| `changelog.d/chat-waiting-baseline.md` | A | 3 | 0 | sent-waiting-baseline |
| `changelog.d/codex-profile-chat-start.md` | A | 4 | 0 | codex-profile-stores |
| `changelog.d/creation-link-machine.md` | A | 3 | 0 | selection-navigation |
| `changelog.d/launcher-autocomplete.md` | A | 4 | 0 | saved-launchers |
| `changelog.d/launcher-editor-search.md` | A | 4 | 0 | saved-launchers |
| `changelog.d/native-working-chat.md` | A | 2 | 0 | working-regression |
| `changelog.d/pending-receipt-recovery.md` | A | 4 | 0 | pending-receipts |
| `changelog.d/remote-pending-receipts.md` | A | 3 | 0 | pending-receipts |
| `changelog.d/saved-agent-launchers.md` | A | 5 | 0 | saved-launchers |
| `changelog.d/worktree-phone-selection.md` | A | 2 | 0 | selection-navigation |
| `docs/agent-launchers.md` | A | 117 | 0 | saved-launchers |
| `docs/codex-unconfirmed/README.md` | A | 96 | 0 | pending-receipts |
| `docs/codex-unconfirmed/codex-confirmed.png` | A | binary | binary | pending-receipts |
| `docs/codex-unconfirmed/codex-not-confirmed.png` | A | binary | binary | pending-receipts |
| `docs/codex-unconfirmed/openclaw-research.md` | A | 34 | 0 | pending-receipts |
| `docs/codex-unconfirmed/reproduce.ts` | A | 121 | 0 | pending-receipts |
| `docs/codex-unconfirmed/result-fixed.json` | A | 120 | 0 | pending-receipts |
| `docs/codex-unconfirmed/result.json` | A | 85 | 0 | pending-receipts |
| `docs/development.md` | M | 2 | 0 | saved-launchers |
| `docs/remote-pcs.md` | M | 7 | 0 | pending-receipts |
| `scripts/chat-browser-qa.ts` | M | 62 | 0 | working-regression |
| `scripts/chat-virtual-fixture.tsx` | M | 16 | 0 | sent-waiting-baseline |
| `scripts/ci-browser.sh` | M | 2 | 0 | selection-navigation |
| `scripts/deep-link-demo-regression.ts` | M | 17 | 0 | selection-navigation |
| `scripts/demo-agent-launch.test.ts` | A | 80 | 0 | saved-launchers |
| `scripts/install-node-fallback.test.ts` | M | 1 | 1 | fixture-isolation |
| `scripts/new-session-skills-browser-qa.ts` | M | 5 | 3 | saved-launchers |
| `scripts/palette-machines-demo-regression.ts` | M | 21 | 1 | selection-navigation |
| `scripts/phone-worktree-sheet-regression.ts` | M | 23 | 0 | selection-navigation |
| `scripts/sent-waiting-browser-qa.ts` | A | 67 | 0 | sent-waiting-baseline |
| `scripts/ui-regression.ts` | M | 4 | 0 | saved-launchers |
| `scripts/worktree-selection-demo-regression.ts` | A | 79 | 0 | selection-navigation |
| `server/agent-launch.ts` | M | 14 | 5 | saved-launchers |
| `server/agent-launchers.contract.test.ts` | A | 262 | 0 | saved-launchers |
| `server/agent-launchers.test.ts` | A | 31 | 0 | saved-launchers |
| `server/agent-launchers.ts` | A | 13 | 0 | saved-launchers |
| `server/agents-routes.test.ts` | M | 7 | 1 | saved-launchers |
| `server/agents-routes.ts` | M | 14 | 3 | saved-launchers |
| `server/api.contract.test.ts` | M | 15 | 4 | saved-launchers |
| `server/codex-processes.test.ts` | M | 82 | 8 | codex-profile-stores |
| `server/codex.ts` | M | 53 | 18 | codex-profile-stores |
| `server/conversation.test.ts` | M | 47 | 0 | codex-profile-stores |
| `server/conversation.ts` | M | 7 | 6 | codex-profile-stores |
| `server/core/pending.test.ts` | M | 42 | 0 | pending-receipts |
| `server/core/pending.ts` | M | 33 | 2 | pending-receipts |
| `server/index.ts` | M | 19 | 6 | saved-launchers |
| `server/launcher-search.test.ts` | A | 49 | 0 | saved-launchers |
| `server/launcher-search.ts` | A | 54 | 0 | saved-launchers |
| `server/machine-api.ts` | M | 1 | 1 | pending-receipts |
| `server/machine-relay.test.ts` | M | 25 | 7 | pending-receipts |
| `server/machine-relay.ts` | M | 23 | 4 | pending-receipts |
| `server/omp-process.test.ts` | M | 2 | 2 | omp-custom-root |
| `server/omp.test.ts` | M | 8 | 0 | omp-custom-root |
| `server/omp.ts` | M | 8 | 4 | omp-custom-root |
| `server/pending-input.contract.test.ts` | M | 128 | 3 | pending-receipts |
| `server/pending-receipts.test.ts` | A | 33 | 0 | pending-receipts |
| `server/pending-receipts.ts` | A | 34 | 0 | pending-receipts |
| `server/saved-launcher-start.ts` | A | 67 | 0 | saved-launchers |
| `server/saved-launchers.contract.test.ts` | A | 292 | 0 | saved-launchers |
| `server/saved-launchers.test.ts` | A | 73 | 0 | saved-launchers |
| `server/saved-launchers.ts` | A | 115 | 0 | saved-launchers |
| `server/shell-agent.test.ts` | M | 32 | 0 | saved-launchers |
| `server/start-screen.test.ts` | M | 16 | 1 | saved-launchers |
| `server/start-screen.ts` | M | 11 | 0 | saved-launchers |
| `server/workspace-routes.ts` | M | 14 | 4 | saved-launchers |
| `shared/agent-launchers.ts` | A | 27 | 0 | saved-launchers |
| `shared/agents.ts` | M | 7 | 1 | saved-launchers |
| `shared/protocol.ts` | M | 16 | 2 | pending-receipts |
| `shared/workspace-lifecycle.ts` | M | 2 | 2 | saved-launchers |
| `site/demo/transport.ts` | M | 52 | 4 | saved-launchers |
| `src/App.tsx` | M | 2 | 2 | selection-navigation |
| `src/components/AgentLaunchPicker.css` | A | 74 | 0 | saved-launchers |
| `src/components/AgentLaunchPicker.test.ts` | A | 293 | 0 | saved-launchers |
| `src/components/AgentLaunchPicker.tsx` | A | 292 | 0 | saved-launchers |
| `src/components/NewSessionDialog.test.tsx` | M | 2 | 0 | saved-launchers |
| `src/components/NewSessionDialog.tsx` | M | 31 | 9 | saved-launchers |
| `src/components/SentWaiting.test.tsx` | M | 19 | 1 | sent-waiting-baseline |
| `src/components/SentWaiting.tsx` | M | 2 | 2 | sent-waiting-baseline |
| `src/components/WorktreeDialog.tsx` | M | 35 | 12 | saved-launchers |
| `src/lib/agentLaunchers.ts` | A | 8 | 0 | saved-launchers |
| `src/lib/api.test.ts` | M | 21 | 0 | saved-launchers |
| `src/lib/api.ts` | M | 25 | 2 | saved-launchers |
| `src/lib/i18n.ja.ts` | M | 31 | 4 | saved-launchers |
| `src/lib/i18n.ko.ts` | M | 31 | 4 | saved-launchers |
| `src/lib/i18n.zh.ts` | M | 31 | 4 | saved-launchers |
| `src/lib/i18n/settings.ja.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/i18n/settings.ko.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/i18n/settings.zh.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/i18n/usage.ja.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/i18n/usage.ko.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/i18n/usage.zh.ts` | M | 1 | 1 | saved-launchers |
| `src/lib/machineContext.tsx` | M | 4 | 0 | saved-launchers |
| `src/lib/newSession.test.ts` | M | 8 | 0 | saved-launchers |
| `src/lib/newSession.ts` | M | 7 | 4 | saved-launchers |
| `src/lib/pendingMessages.test.ts` | M | 22 | 0 | pending-receipts |
| `src/lib/pendingMessages.ts` | M | 11 | 12 | pending-receipts |
| `src/lib/sentWaiting.test.ts` | M | 19 | 1 | sent-waiting-baseline |
| `src/lib/sentWaiting.ts` | M | 9 | 0 | sent-waiting-baseline |
| `src/lib/useAddressBar.ts` | M | 14 | 4 | selection-navigation |
| `src/lib/useSelection.ts` | M | 5 | 4 | selection-navigation |

## Outstanding PR snapshot

Scope: open upstream PRs authored by `christso`, and all open fork PRs. These queries cover the public repositories only; PRs are not part of the pinned tree diff.

All pages queried. Each repository has its own query timestamp; this is not live PR status.

devswha/ovis, queried 2026-10-31T09:16:38.492388+00:00; author: christso.

No outstanding PRs in this successfully queried scope at that time.

christso/ovis, queried 2026-10-31T09:16:39.005013+00:00; author: all.

| PR | Title | State | Base | Head commit |
| --- | --- | --- | --- | --- |
| [#3](https://github.com/christso/ovis/pull/3) | docs: trace review risks beyond changed lines | Open | `christso/main` | `763e3829c485797b13808857f99dbc5a6637101e` |
| [#10](https://github.com/christso/ovis/pull/10) | fix(chat): clear stale sent bubbles after pane connection changes | Open | `christso/main` | `f78083aba289aee1eaaa89f90330a019e53e3584` |

## Refresh and render

Run from the repository root. The [tool](../../scripts/fork-status.py) requires Python 3 and Git for local refresh; rendering the [canonical JSON](status.json) requires only Python 3, with no Git, GitHub or network access.

Render this snapshot without changing its source pins or timestamps:

```sh
python3 scripts/fork-status.py render --input docs/fork/status.json --output docs/fork/status.md
```

Refresh from locally available tracking refs (defaults: `origin/christso/main`, `upstream/main`):

```sh
python3 scripts/fork-status.py refresh --out docs/fork
```

Recompute the product comparison from the exact source pins used above (creates a new snapshot time):

```sh
python3 scripts/fork-status.py refresh --fork-ref f78083aba289aee1eaaa89f90330a019e53e3584 --upstream-ref 3c6797913ce711b5dd870f3016e72ebde95b6a8f --out docs/fork
```

`--github` additionally requires the GitHub CLI (`gh`) with access to the public repositories and network access. It queries all open PR pages in the scope above. Without it, PR status is explicitly unknown; a query failure exits nonzero before writing reports.

`--fetch` explicitly fetches only `origin`'s `christso/main` and `upstream`'s `main` into their tracking refs, without pruning, tags or submodule fetches. Configure those remotes for the fork and upstream first. Fetch is optional and is the only Git mutation; the tool never checks out, stages, deletes refs or changes branches.

Refresh writes only `status.json` and `status.md` in `--out`; render writes only `--output`. Both commands accept paths relative to the caller's directory. `--repo` can select another local checkout for refresh; it defaults to this tool's repository. No application state is read.
