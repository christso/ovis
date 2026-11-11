# Graph and its work registry

Graph opens a force-directed graph of native workspaces, linked worktrees and tabs. Regular tabs
connect directly to their workspace; linked worktrees use workspace → worktree → tab, following
the sidebar's native grouping. Each tab appears once, even with several split panes or agents.
Plain folders need no Git repository to have a workspace hub. Empty workspaces remain visible;
a worktree whose main workspace is not open has its own independent hub. Repository, branch,
checkout and session information appears in the inspector.
Ovis's native Agents section remains the single agent list and keeps its existing filters. The
old Table view and association/work-renaming/Move controls are retired from navigation; the
registry, existing associations and migration APIs remain intact. Legacy `page=table` links open
Graph. Open in Workspace resolves the selected node's verified current target without focusing
Herdr or sending input.

Colours identify node types: blue for workspace, orange for worktree, green for tab and purple for pane.
These hues stay consistent across palettes, with darker shades in light mode. The legend sits below the
canvas and can be collapsed; that preference survives reloads.
Working nodes have a soft rotating halo around their edge instead of a small spinner icon. It
keeps the node's type hue, with a lighter halo in dark themes and a darker one in light themes.
The glow overlaps the node, and its thickness stays visible when zoomed out. The disc slowly dims
and brightens while work runs. When work stops, both effects disappear.
Reduced motion stops both animations; stale or disconnected working reports also stay static. Other
statuses keep their distinct icons, and status remains available in each node's accessible name.
Each legend entry also toggles its node type. Hidden entries stay faded and crossed out, ready
to restore with another click, tap, Enter or Space. Hiding a type removes its nodes and incident
links and lets the graph settle into a new layout. Worktree tabs are never reconnected to a
workspace when their worktree is hidden; only tabs directly on the workspace keep that link.
Type visibility survives reloads and is included in copied graph links.

Panes are hidden by default. Click **Pane** in the legend to reveal individual terminals under
their tab: workspace → worktree → tab → pane, or workspace → tab → pane for a main workspace tab.
Each pane shows its own name and status. **Open in Workspace** selects that exact verified live
terminal; a disconnected, restored or replaced occupant cannot inherit an old action.
Showing pane links increases their tab's size. Hiding tabs removes those links without reconnecting
panes to a worktree or workspace. Communication and delegation remain on tabs.

Short, strong hierarchy links keep each workspace's worktrees and tabs together, while weaker
communication links connect clusters. Node radius counts distinct visible connections of every type: hierarchy, communication and
delegation. More direct tabs and worktrees make their parent hub larger. Folio-style capped
square-root growth makes a five-connection hub roughly three times the area of a one-connection
node at the same zoom. Hidden connections shrink their nodes; large hubs have a size cap.
Names use native
workspace/tab labels and launcher metadata without reading transcripts or inferring session
identity. Dragging moves linked neighbours; the simulation stops when settled. Fit/Reset are
intentional framing actions, and polling does not move an idle graph.

**Group by machine** also draws a translucent, named cloud behind each machine's visible nodes.
The clouds follow the nodes as they move, while node colours identify their types.
Filtering updates each cloud and removes empty ones; Fit includes the cloud boundaries. Clouds
do not block selection, dragging or panning. Dragging tabs across a cluster can overlap clouds
without changing which machine a tab belongs to.

The retained registry gives each logical session its own ID and a current execution ID. An execution records the machine,
Herdr lifetime, pane, agent kind and native session ID. A later execution can belong to the same
logical session on another machine; its earlier executions remain in the registry. This records an
association only. It does not transfer or restore anything.

A registered execution is live only when its entire binding matches the connected machine's roster.
Disconnected, missing and replaced sources remain visible without a terminal target. An unadopted
pane whose bridge cannot prove its Herdr lifetime or whose agent reports a path instead of an ID
shows **Identity unavailable**. Native Workspace/Agents controls remain available. Graph opening
requires either exact current Herdr occupancy or independently verified native ownership.
Repository and branch metadata appear only when known. Live branch labels reuse the sidebar's
Git reader. A recorded checkout is physical metadata, not an inferred global repository identity
or a promise that it still exists on disk. Graph uses exact machine, daemon, tab and pane/terminal membership to distinguish tabs. Agent
occupant identity also guards navigation; metadata names never authorize a target. Old selections
do not follow a logical session to a different tab after a move.

Workspace focus follows the sidebar’s native worktree grouping, including its nearest preceding
main-checkout workspace rule. A workspace filter includes its horizontal tabs and the tabs in its
nested worktrees. A worktree’s sole numbered tab uses the sidebar workspace name; several or
explicitly named worktree tabs include workspace context. Hub opening chooses only a verified
current tab belonging to that hub; it never substitutes a tab from a child worktree. Empty hubs
have no terminal action. Hub identity includes its machine, daemon, workspace and pane/terminal set,
so an old selection cannot open a replacement terminal.

Graph layout and legend disclosure preferences live in the browser's `ovis:graph:v2` localStorage key,
owned by `graphState.ts` and `useGraphState.ts`. On the first v2 read, supported v1 selection,
filters and machine grouping are retained, while coordinates and viewport are reset once to
form the new hierarchy. The original `ovis:graph:v1` bytes remain unchanged: older tabs and
rollback releases keep reading/writing v1, and current tabs write only v2. An existing unknown
version, layout or malformed v2 value is never overwritten. Saved v2 coordinates and viewport
continue to win on subsequent reloads. These preferences do not change any HTTP/WS contract.

Type visibility is also owned by `graphState.ts`/`useGraphState.ts`. The existing
`ovis:graph:kinds:v1` record stays `{ version: 1, hiddenKinds: [...] }` for workspace, worktree
and tab. Pane visibility uses its own `ovis:graph:panes:v1` record,
`{ version: 1, visible: boolean }`, defaulting to false. Older tabs and rollback clients never
write this key, so saving their other preferences cannot erase the pane choice. Readers and writers
preserve malformed or unsupported-version records byte-for-byte. Copied URLs use `gk` for the
original three types and `gp=1` to show panes; old links without `gp` keep panes hidden.
No server registry, file format or HTTP/WS contract changes.

Graph was previously named Flock. Its modules, types and navigation now use Graph. The stored
`flock.json` filename, `/api/flock` route, `flock=1` inventory query, `flock_*` snapshot fields and
registry error codes retain their legacy names so existing data and older remote bridges continue
to work. Renaming the feature does not migrate or duplicate saved registries.

The manager serving the configured roster owns `flock.json` in its Ovis state directory. The writer
is `server/graph-registry.ts`; the shared contract and pure roster projection live in `shared/graph-registry.ts` and
`shared/graph-registry-inventory.ts`. Graph and the retained migration APIs share this inventory. The document
is new in this feature, with no previous shape to migrate:

```ts
{
  version: 1,
  revision: number,
  works: GraphWork[],
  sessions: GraphSession[],
  checkouts: GraphCheckout[],
  executions: GraphExecution[]
}
```

This release reads/writes version 1. Earlier releases know nothing about this separate file and do
not rewrite it. Disk and API readers share the validator in `shared/graph-registry-schema.ts`. Unknown API
formats leave the rest of the app working and disable registry writes until a supported reload. An unknown version, malformed record or broken reference refuses reads and writes
without replacing its bytes. Writes use the existing private temporary-file/rename helper. Each
mutation rereads the document and checks its revision, preventing another browser's stale change
from replacing newer work. There is no distributed synchronization or automatic recovery from a
lost manager. Back up the manager's state directory to keep these associations.

The authenticated manager API is `GET /api/flock` and `POST /api/flock` with
`{ revision, command: GraphCommand }`. Both return the registry and `Cache-Control: no-store`.
POST requires the normal same-origin mutation check and `X-Herdr-Machine: 1`. Watch devices cannot
read or change this document because it includes physical checkout metadata. The API is not a
per-machine proxy route and a bridge-only credential cannot access it. Adoption checks a fresh
source snapshot before writing; it never trusts a browser-supplied binding without that check.
Stale revisions/bindings return `409 flock_conflict`; unreadable formats return
`503 flock_unreadable`; invalid commands return `400 invalid_flock`.

A subsequent `adopt` command with `session_id` appends a new execution and updates that session's
current execution ID atomically. Optional `expected_execution_id` additionally checks the current
execution before appending, for intentional Move's compare-and-swap. Move owns its operation journal
and idempotence. No terminal lifecycle operation is performed by the registry itself.

## Observed agent relationships

Graph's inspector shows read-only delegation and communication relationships. The manager
collects successful native coordination receipts alongside verified source inventory and retains
only endpoint identities, labels, event IDs, relationship kinds and occurrence times in the optional `observations`
array of `flock.json`. Repeated polling does not add events or increase message counts. Historical
execution bindings resolve endpoints to logical sessions, preserving links through a planned move.
Native receipt identity is independent of its capture machine, so replay after copying a rollout
does not count another message. The first capture's machine provenance is retained. Older stored
duplicate captures remain readable and are counted once in the graph.
Recorded endpoints map to their current represented tabs. Parallel endpoint pairs between two tabs
combine into one directed relationship with summed receipt counts; same-tab activity adds no extra
node or link. An endpoint without one unambiguous represented tab never adds a graph node. Its direct activity
with a represented tab appears in that tab’s collapsible **Recorded agent activity** details,
including related-session count, direction, receipts, timestamps and sources. These read-only
records have no navigation controls and make no claim about current liveness or parentage. Records
with neither endpoint mapped to a tab remain in the registry without being attributed to a tab.
Communication-link filters affect graph links; the details retain all recorded activity.

Capture currently supports Codex's durable completed `SubAgentActivity` receipts with an own-thread
ID, native target ID and a successful `started` or `interacted` activity. The source reader follows
the same verified rollout as native ownership, checks the source identity and reads complete records
within a bounded budget. Unsupported/legacy formats and earlier transcript segments may have no
coverage. The custom Herdr fork additionally records successful attributed CLI start/prompt
operations in its private daemon journal. Ovis reads its optional `agent.coordination.list`
extension in bounded pages and retains closed-agent history. The daemon's server, boot, terminal
and occupancy identities distinguish agents even when names or pane IDs are reused. A pane move
does not create a new agent relationship. This capture works across the CLI kinds Herdr recognizes;
it does not depend on parsing shell commands or message text. Stock Herdr has no such extension; the optional CLI shim described below supplies local operation
observations without modifying Herdr. Missing support disables only that capture.
Prose mentions, failed operations and old bridges without either producer supply no links.

Current Herdr occupancy is a terminal-location proof, not a native-session ownership proof. Only
an independently verified native binding can add an optional `herdr_associations` entry joining
that occupancy to a logical session. These associations remain after closure or a planned move;
conflicting native identities leave the endpoint unassociated. Native adoption and Move retain
their existing ownership requirements. Source reads that fail or change daemon/terminal/occupancy
drop current-location proof. Private coordination inventory is never added to ordinary session
responses, and unavailable inventory cannot make a historical endpoint targetable.
The inspector does not expose message contents. Its counts describe recorded receipts, not delivery
acknowledgements or a complete communication history. A recorded launch is directed from the
caller to the created agent. A message establishes communication without changing their parentage.

There is no manual agent-link editor or browser relationship mutation command. Existing work
membership and execution/session association remain identity operations. Observations are passive:
they do not alter prompts, send messages, assign work, grant control or block execution. Graph consumes these recorded relationships.

The native format is pinned to [Codex0.166's activity item](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/protocol/src/items.rs)
and [successful message dispatch](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs).
Watch-only devices cannot read the registry or coordination inventory through either direct or
per-machine proxy routes.

## Stock Herdr CLI capture

Linux and macOS can capture ordinary `herdr agent start` and `herdr agent prompt` calls through
an optional PATH shim. Keep the fork where agent-instance and saved-machine attribution are needed;
installing this tool does not switch Herdr runtimes. It executes the installed Herdr binary directly; Ovis is not in the command
path and need not be running. Each confirmed operation writes one private, atomic, fsynced metadata
record locally. Ovis reads those records when Graph next reads its source, retaining history and
counting each receipt once. Native Codex capture continues independently. A fork journal takes precedence for receipts from the current boot whose source and target both
belong to that same daemon. Earlier-boot and cross-session receipts retain their CLI provenance:
source fork capability alone cannot prove that another daemon captured the operation. Cross-session
history from both producers can overlap because their event IDs do not establish a shared receipt.

Install into a new directory from a stable Ovis checkout:

```sh
bun scripts/herdr-shim.ts install \
  --real /absolute/path/to/the/installed/herdr \
  --directory /absolute/path/to/ovis-herdr-bin
```

The installer bundles its code into that directory and writes a launcher named `herdr`. It refuses
an existing destination or another Ovis shim as the real executable, and never overwrites Herdr,
changes shell files, edits Herdr configuration or restarts a service. The installed Bun executable
must remain available. Install a later shim version into a new directory, then change PATH; the
installer never upgrades or deletes an unknown directory in place.

Prepend the directory to PATH in the environment that launches agents, for example:

```sh
export PATH="/absolute/path/to/ovis-herdr-bin:$PATH"
```

This applies to newly launched processes; existing agents keep their inherited PATH. Herdr's shell
configuration can replace PATH, so verify `command -v herdr` inside the actual agent environment.
Removing the PATH entry restores direct Herdr resolution. The real executable stays available at
its original absolute path and remains managed by Herdr's normal updater.

The default journal is `$XDG_STATE_HOME/ovis/herdr-cli`, or `~/.local/state/ovis/herdr-cli` when
XDG_STATE_HOME is unset. `--journal /absolute/directory` chooses another location at installation;
set `OVIS_HERDR_CLI_DIR` to that same directory for Ovis to read it. A journal contains a stable,
versioned namespace identity and version 1 files shaped as `{ version: 1, receipt }`, owned by
`server/herdr/cli-observations.ts`. Records are immutable and survive both Ovis and Herdr restarts. Keep the
journal and `flock.json` when backing up relationship history. An unreadable or unknown identity
format is never replaced; unknown, malformed, oversized and partial event files are skipped.
Each reader pass scans at most 1000 directory entries, keeping its place between reads; a large
journal may take several polls to catch up.

Namespace identity, Herdr socket incarnation and terminal ID distinguish CLI event endpoints.
An event describes activity at a terminal, projected onto that terminal's current tab. Agent names
and kinds are captured labels, not identities. A successful start does not prove which process now
occupies that terminal: even when a worker is replaced before the shim observes the reply, the
record remains an operation addressed to that exact terminal. It creates no agent-instance or
native-session association. Recreated terminals and daemon restarts cannot inherit these links.

Caller validation and navigation are separate: the source's process/kernel birth is checked before
and after execution, and stock Herdr's current process inventory provides Graph's terminal-location
proof for supported recognized agents. An old process-specific node selection cannot open a
replacement through a historical CLI event. Adoption and Move still require their separate
native-session ownership proof.

The caller is resolved in its inherited Herdr socket context. An explicit `--session` selects the
operation's target, even when another server gives out the same pane ID. `--machine` and `--remote`
commands pass through unchanged but currently produce no shim receipt. Other commands, including
interactive attachment and Herdr's updater, execute the real CLI with inherited stdio. Supported
start/prompt calls stream Herdr's own output and preserve its exit status and signal result;
waiting, submission and cancellation remain Herdr's responsibility. The shim never retries or
replays a command.

A successful `prompt --wait` submission is still recorded when Herdr 0.9.3 later reports its
specific status-wait timeout or `agent_prompt_stalled` error and the original recipient can still
be verified. An exit status alone is not delivery evidence. Unfamiliar output, a timeout before
submission, an unverifiable/replaced caller or a changed daemon supplies no receipt. Successful
start/prompt replies identify their terminal even if its process later exits; a status-wait error
with no reply terminal and no verifiable recipient supplies none. A start that times out and
becomes ready later also supplies none. Timestamps describe the observed invocation, not a
recipient read acknowledgement. No message text, native arguments or terminal output is persisted.

This is cooperative observation, not enforced attribution or a complete audit log. An absolute
call to the real binary, a direct socket request, interactive typing or an unwrapped remote call
bypasses capture. A storage failure, a killed shim or another ambiguous result can leave a gap;
commands continue even when metadata cannot be recorded. Windows installation is not supported
by this shim yet. These limits do not prevent stock Herdr's ordinary commands from working.

The persistent Graph format stays at version 1. Terminal-scoped receipts use a separate optional
`cli_observations` array, validated by `shared/graph-cli.ts`; existing fork/Codex `observations` and
`herdr_associations` retain their shapes and meanings. New readers label CLI evidence **Herdr CLI ·
Terminal activity** and use neutral wording for its history. Older version 1 clients ignore the new
array while preserving unknown fields when they write known registry changes; they keep reading
existing native/fork history. Older Ovis releases do not read or rewrite the separate CLI journal.
Rollback needs no migration or deletion; remove the shim's PATH entry to return to direct resolution.
The new `graph_cli` source-snapshot field is private to authenticated Graph reads, like the existing
legacy-named Graph evidence fields. Its optional `current_agents` array holds ephemeral process
proof separately from terminal receipts; it is never persisted as `herdr_associations`. The legacy
`flock_coordination` field remains fork-owned, so older managers ignore CLI process proof. Open
rechecks the selected process against a fresh source response before navigating to its pane.
Watch devices cannot read this history, current process evidence or namespace data.
