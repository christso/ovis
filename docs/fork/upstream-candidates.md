# Upstream candidates and dogfooding

Updated 2026-10-31. Keep fixes in the fork while they are exercised in normal use. Prepare upstream
issues or PRs once the evidence supports them; elapsed time alone does not establish confidence.
This record does not submit anything upstream.

The [pinned comparison](status.md) and [file inventory](status.json) compare the fork's committed
product changes with its last integrated upstream revision, `3c679791`. The newer upstream tip
observed on 2026-10-31 was `41492320`, with 36 commits not yet integrated. Fetch upstream again
before proposing a change and check whether it already solves the problem.

The inventory includes implementation, tests, changelog fragments and historical evidence. Changed
files do not automatically establish an upstream bug. Shared files are classified once under their
primary area; their counts do not imply exclusive ownership by that feature.

## Candidate register

| Candidate | Fork evidence | Status and next evidence |
| --- | --- | --- |
| Exact pending-message receipt recovery | [PR #9](https://github.com/christso/ovis/pull/9), [red/green reproduction](../codex-unconfirmed/README.md), existing [upstream issue #2421](https://github.com/devswha/ovis/issues/2421) | Merged and deployed before this rollout; dogfooding. Exercise local/relayed sends, phone suspend/reconnect and reload: recover exact outcomes without extra terminal input. Keep expiry/restart/bridge-version limits explicit. Update the existing issue instead of creating a duplicate. A separate waiting-bubble symptom does not establish failure of receipt recovery. |
| Faded sent bubble remains beside its transcript turn | [PR #10](https://github.com/christso/ovis/pull/10), `src/components/SentWaiting.test.tsx`, `scripts/sent-waiting-browser-qa.ts` | Automated red/green reproduction: disconnected sibling plus browser clock two seconds ahead. Original phone clock offset and event ordering are unknown. Record deployed-asset verification and subsequent dogfooding in PR #10's comments. Exercise running turns, tab changes and phone background/resume before claiming the original phone case resolved. |
| Codex custom session stores | `codex-profile-stores` in the pinned inventory; native-store/process-binding tests | Retained functionality, not yet marked upstream-ready. Recheck current upstream support; exercise custom Codex homes, multiple sessions in one directory, resume and process replacement. Isolate a failing upstream case. |
| OMP custom config roots | `omp-custom-root` in the pinned inventory | Retained functionality, not yet marked upstream-ready. Exercise default/named profiles and custom `PI_CONFIG_DIR`; establish what current upstream still misses. |
| Pane/PC selection and navigation | `selection-navigation` in the inventory; deep-link, palette and worktree regressions | Retained fixes and coverage. Dogfood desktop/phone navigation, roster refreshes and Back/Forward. Separate individual upstream defects rather than proposing the whole fork diff. |
| Saved launchers and executable search | [Launcher guide](../agent-launchers.md), fork PRs #4–#7, `saved-launchers` in the inventory | Fork feature/UX choice, not a confirmed upstream defect. Earlier profile-picker code was replaced. Dogfood local/remote executable and argument choices; agree feature scope with upstream before implementation PRs. |
| Extra regressions, history and shared design notes | `working-regression`, `fixture-isolation`, `shared-design-notes` in the inventory | Coverage/documentation, not extra product behavior. Native Working/footer behavior already upstream is not fork-exclusive. Offer regressions only for current gaps; leave obsolete fragments and fork-only deployment material out of patches. |

## Observations and promotion

Use each candidate's fork PR comments for dated rollout and dogfooding observations. Link material
observations here when they change readiness. Record deployed commit, relevant bridge versions,
device/browser, action sequence, expected/observed message counts, receipt availability and any extra
terminal input. Keep automated fixtures separate from native-agent runs and ordinary phone use.
Record recurrences as well as green runs. Use owned test data for shareable evidence; omit private
conversations and credentials.

Before proposing an upstream PR, reproduce on the current upstream revision, show the focused patch
turning it green, complete relevant checks and review normal-use observations. State known limits
and unverified original triggers. Link an existing issue where possible and follow upstream's
feature approval process for product changes. The maintainer decides when dogfooding is sufficient.
Record submitted issue/PR links here; retire a fork patch only after verifying the integrated version.

Refresh after committing fork changes, using the last integrated upstream pin:

```sh
python3 scripts/fork-status.py refresh --fork-ref HEAD --upstream-ref 3c679791 --github --out docs/fork
```

Reporting files are excluded from product counts. Advance the upstream pin when upstream is
integrated; the pinned comparison does not claim the fork contains the newest upstream changes.
