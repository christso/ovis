# Maintaining the fork

The latest upstream sync is `958a3cdd576ce0c7fb3efaa2ec7d647afb410537`
(`devswha/ovis`, 2026-11-18). It is a parent of the fork's upstream merge,
`b04fc2335a1c8ea0a2f0c7514450a3684c5b30ab`. Preserve that **true merge ancestry**;
do not squash the upstream merge away. A future merge should compare upstream's new
work with this shared ancestor, rather than replay every already imported change.

## Ownership and integration

Upstream owns the workspace shell, inbox modes, pane selection and the address bar's
single popstate listener. The fork keeps these additions:

- `src/lib/graphPage.ts` owns the Graph/Workspace state, workspace-return command,
  private registry subscription and inventory, and page-only history writes before a
  pane link has landed. That writer preserves the pane target, unknown parameters,
  relay fragments and history state. Its caller holds writes for unread popstate.
- `src/features/graph/GraphEntry.tsx` owns the access gate and lazy Graph panel.
  The other Graph modules own presentation, filters, layout and evidence rendering.
- `src/App.tsx` integrates Graph with the existing shell: native picks and inbox
  entry return to Workspace; Graph hides pane controls and covers the pane for
  activity tracking. Header, sidebar, content and inbox gates remain explicit here.
- `src/lib/useAddressBar.ts` retains the upstream pane/file/inbox history flow.
  Its Graph integration adds the page field, calls the page-only writer before
  selection is ready, keeps page transitions as entries, and restores the popped
  page after native pane selection. Keep the unread-pop guard before either writer.
- `src/lib/deepLink.ts` owns the URL contract: `page=graph` is independent of the
  pane's `view=chat|terminal`; retired `page=table` links still land on Graph.
- Peer message rendering and source navigation live in `src/lib/messageSourceContext.tsx`
  and their existing chat modules. Graph and peer evidence producers remain in
  their existing server/shared modules; matching names or nearby panes do not prove
  a recorded relationship.

This is a small seam, not a conflict-free shell replacement. App still has Graph
integration hunks wherever upstream presents workspace controls, and the history
hook still has ordering-sensitive integration. Review those together after a sync.
Do not move upstream inbox or file policy into a second fork-owned writer.

## Runtime and builds

The synced baseline was verified with official, unmodified **Herdr 0.9.5**
(Linux x86_64 SHA-256
`14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d`).
A custom Herdr binary is not required. Optional native coordination capabilities
remain opt-in; fixture evidence does not establish support for those capabilities.

Build and install this fork from source with `OVIS_FROM_SOURCE=1`, following
[INSTALL.md](../INSTALL.md#binary-or-source). For example, after installing the
locked dependencies in the chosen fork checkout:

```sh
bun install --frozen-lockfile
OVIS_FROM_SOURCE=1 bun run build
```

Keep `OVIS_FROM_SOURCE=1` on the source install/plugin invocation too. An official
prebuilt Ovis server does not establish that the fork's server customizations ran.
Do not change the upstream version or release artifacts just to record a merge.

## Updating and checking

Use a fresh worktree and branch, with a clean source tree. Fetch the named upstream
remote, record its exact commit, and merge that commit normally into the fork.
Resolve Graph policy in the modules above while retaining upstream inbox and native
workspace behavior. Keep each additional refactor separate from conflict resolution.

```sh
git fetch upstream
git merge --no-ff <pinned-upstream-commit>
git merge-base --is-ancestor <pinned-upstream-commit> HEAD
```

Use a writable temporary directory outside `/tmp` on hosts with a small tmpfs.
The check runner isolates Herdr configuration and state; never set `HERDR_TEST_LIVE=1`.
See [development.md](development.md#checks) for the complete check contract.

```sh
mkdir -p "$HOME/.cache/ovis-tmp/fork-sync"
export TMPDIR="$HOME/.cache/ovis-tmp/fork-sync"
bun test src/lib/useAddressBar.hook.test.ts src/lib/useAddressBar.test.ts src/lib/deepLink.test.ts
bun run typecheck
bun run check fast
```

Run affected browser scripts in the CI runner image as its unprivileged user, using
synthetic source/state and read-only Git metadata. Start a shell explicitly instead
of the Actions runner entrypoint; mount no host credentials or real Herdr state.
For this seam, cover Graph, deep links, inbox, file return and shared shell controls:

```sh
bun run check run --build bun scripts/graph-app-demo-regression.ts
bun run check run --build bun scripts/deep-link-demo-regression.ts
bun run check run --build bun scripts/inbox-mode-demo-regression.ts
bun run check run --build bun scripts/files-panel-demo-regression.ts
bun run check run --build bun scripts/ui-regression.ts
bun run check run --build bun scripts/ui-terminal-regression.ts
```

Smoke-check Graph ↔ Workspace, native pane picks, Back/Forward, copied and legacy
links, offline/reconnecting PCs, inbox threads and files left behind. Unknown or
watch-only roles must not fetch private Graph data or its lazy panel. Keep process
watcher privacy and recorded-evidence rules unchanged. Broaden integration and
platform coverage when their code changes; browser fixtures cannot replace native
producer or platform verification.
