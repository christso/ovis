# Graph and its work registry

Graph shows **Repository → Terminal**. One neutral grey repository hub joins checkouts and
workspaces on different machines only when their owning bridges report the same canonical Git
remote. Workspace and worktree are navigation context, not graph node levels. Each pane appears
once as a terminal; a single-terminal tab keeps its native name and split terminals keep their
individual names. The inspector and complete SVG title retain machine, workspace, branch,
checkout path and session context. A terminal outside Git has a machine-scoped **Folder** hub.
Empty workspaces do not add nodes. Ovis's native Agents section remains the single agent list.
Legacy `page=table` links open Graph; the registry and migration APIs remain intact.

Repository hubs always use `--graph-repository`, a neutral grey with light/dark contrast, without
status icons or activity halos. Terminals use the sidebar's `paneStatus` and semantic theme tokens:
RUN uses `--status-working`, DONE uses `--status-done` and a tick, INPUT uses `--status-blocked`
and a question indicator. BG uses the working colour with a static background-wait indicator,
not INPUT. READY, unknown, stale, disconnected and unavailable sources are muted. Theme variations
remain the sidebar's. Only a live working terminal has the rotating half-ring and breathing halo;
reduced motion stops both animations. Status and freshness remain in accessible names.

Both node types start visible. The legend always shows the Repository and Terminal toggles in a
compact row, without a disclosure control. An older collapsed-legend preference cannot hide them. Hidden
terminal communication/delegation projects to its repository or folder; original terminal endpoint
eligibility still controls search, status and machine filtering. Projection preserves direction,
kind, receipt counts, newest activity and provenance. Collapsed self-links disappear. With only
terminals visible, original relationships remain, including within one repository or tab. With both
types hidden the graph is empty. Historical endpoints stay in activity details without invented
nodes or terminal actions. Focus on a hidden terminal retains only its own projected receipts.

Hierarchy links keep repositories and their terminals together; weaker relationship links connect
clusters. Radius counts distinct visible neighbours of every link kind. Parallel receipts, replies
and event counts never inflate it. The Folio-style capped square-root curve makes a five-link hub
about three times the area of a one-link terminal. Dragging pulls connected neighbours, and the
simulation stops when settled. Status polls preserve positions and viewport; Fit/Reset explicitly
reframe it. **Group by machine** draws labelled clouds and groups terminals only. Shared hubs
have no machine owner and are excluded from clouds and machine lanes. Machine filtering retains
the hubs of the included terminals. Fit includes cloud bounds.

## Repository identity evidence

`verifyGraphSnapshot` adds optional `graph_repositories` to on-demand graph source snapshots
(`/api/session?flock=1` and `/api/flock?sources=1`). Each entry binds `pane_id`, `terminal_id` and
`cwd` to the actual Git `common_directory`, checkout `root` and sanitized canonical `remote`.
The bridge reads local Git using the existing bounded read-only subprocess runner, four directories
at a time with a two-second total budget (one second per subprocess), and discards results when the daemon lifetime or pane location changes during the read.
Budget exhaustion returns only the evidence already read; unavailable directories gain no remote
identity. It neither contacts a remote nor writes identity evidence to the work registry. Raw URLs and their
credentials never enter graph responses, IDs, UI, browser storage or logs.

Selection policy: read effective Git configuration, including includes; use `origin` when present,
otherwise require exactly one remote URL. `git remote get-url --all` expands configured fetch URL
rewrites before canonicalization, without network access. Duplicate
origin URLs, ambiguous remotes, unsupported local/file remotes and read failures fall back locally.
SSH SCP syntax and `ssh://` normalize host case, trailing slash and default ports.
Only documented public-forge namespaces strip `.git`; generic hosts retain it as part of the path.
Ambiguous repeated `.git` suffixes on public forges fall back locally.
Only the conventional `git` SSH account is supported. GitHub.com, GitLab.com and Bitbucket.org
map that account at the default port to their HTTPS repository namespace. On other hosts, SSH
retains its transport and relative (`~/`) versus absolute path; it never collapses into HTTPS.
Other SSH accounts and password-bearing SSH URLs fall back locally. HTTPS credentials are stripped
for those public forges; credential-bearing HTTPS on other hosts falls back locally because an
account may select a different namespace. Nondefault-port services retain generic-host semantics.
Nondefault ports retain their transport and port. Repository path case is preserved; host aliases,
redirects and similarly named repositories are not guessed equivalent. Hosts, owners,
repository paths and forks remain distinct. Query/fragment URLs are rejected. This identity means
configured remote equivalence, not proof of server-side redirects or repository ownership.

Without a canonical remote, a verified common Git directory is scoped to its machine. Older bridges
without discovery can use native `repo_key` only locally and only while cwd remains within its
checkout path. A local `.git` path is never a global key. Current discovery overrides older workspace
metadata: a directory found outside Git becomes a Folder hub. Folder identity is always scoped to
its machine and exact path. Older peers can therefore remain separate until upgraded.

## Navigation and state

**Open in Workspace** exists only on terminals. A shared hub never selects a machine or an
arbitrary child. The action refreshes inventory and resolves the exact current machine, daemon,
workspace, tab, pane/terminal and agent occupant binding. Disconnected, restored, replaced, stale,
unsupported and historical targets cannot inherit an old action. Shell terminals remain openable
independently of unverified sibling agents. Browser selection neither focuses Herdr nor sends input.
Renames and sibling changes preserve terminal identity. Legacy workspace focus links retain their
native worktree-group membership without turning shared hubs into workspace descendants.

The retained registry records logical sessions and executions, including historical executions after
intentional moves. A registered execution is live only when its entire binding matches the roster.
Graph opening requires exact current Herdr occupancy or independently verified native ownership;
a raw native-session hint alone is insufficient. Repository identity never supplies action authority.
Live branch context continues to reuse the sidebar's reader.

Graph preferences use the isolated `ovis:graph:v4` key:
`{ version: 4, layout: "force", selected, filters, groupMachine, legendOpen, positions, viewport }`.
`filters.hiddenKinds` contains `repository` or `terminal`. Current pages read/write v4 only. On the
first read without v4, the newest available supported v3/v2/v1 store supplies compatible filters,
grouping, legend disclosure, terminal selection and legacy workspace focus. Layout coordinates and
viewport reset once for the new topology. Removed workspace/worktree node selections and visibility
settings are discarded; old hidden tabs map to hidden terminals. Optional old pane visibility is
ignored. `legendOpen` remains serialized for compatibility but no longer controls visibility.
Older/future/malformed stores are never rewritten. Unknown v4 versions/layouts and damaged
records also block writes to their own key. Old open pages and rollback retain their original bytes.
Copied links accept old `gk=tab`, ignore removed kinds and retire `gp`, preserving Ovis pane/view
fields. Browser-local state is not part of the server registry.

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
an optional PATH wrapper. Graph's communication links describe terminals and tabs, so stock Herdr
provides the IDs these links need. Saved-machine capture still uses the fork; enabling this tool
does not switch Herdr runtimes. It executes the installed Herdr binary directly; Ovis is not in the command
path and need not be running. Each confirmed operation writes one private, atomic, fsynced metadata
record locally. Ovis reads those records when Graph next reads its source, retaining history and
counting each receipt once. Native Codex capture continues independently. A fork journal takes precedence for receipts from the current boot whose source and target both
belong to that same daemon. Earlier-boot and cross-session receipts retain their CLI provenance:
source fork capability alone cannot prove that another daemon captured the operation. Cross-session
history from both producers can overlap because their event IDs do not establish a shared receipt.

In **Settings → Agents → Communication tracking**, choose **Enable communication tracking**.
The confirmation lists the shell startup files Ovis will change on the selected PC. After approval,
Ovis installs its wrapper, adds a managed block for new Herdr terminals, and verifies command lookup
in a fresh shell. No commands or code need copying. Existing agents keep their inherited environment:
relaunch them to use the wrapper. Ordinary terminals outside Herdr keep their existing command lookup.

Use **Disable communication tracking** to stop new CLI records and remove Ovis's shell setup.
The installed wrapper remains as a passthrough for existing agents, so their commands continue to work.
Recorded history is retained. **Check again** reads the current setup without changing it. Unsupported
platforms and shells are identified in the settings row; an older remote Ovis needs updating before
it can offer setup. This is a setting on each PC, not a browser preference.

For a separate, manually managed installation, install into a new directory from a stable Ovis checkout:

```sh
bun scripts/herdr-shim.ts install \
  --real /absolute/path/to/the/installed/herdr \
  --directory /absolute/path/to/ovis-herdr-bin
```

The installer bundles its code into that directory and writes a launcher named `herdr`. It refuses
an existing destination or another Ovis shim as the real executable, and never overwrites Herdr,
changes shell files, edits Herdr configuration or restarts a service. The Settings flow additionally
manages its own shell startup blocks; the standalone command does not. The installed Bun executable
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

## Received peer messages

After refreshing an owned wrapper through **Enable communication tracking**, supported future
`herdr agent prompt TARGET TEXT` sends from a verified agent carry a generated peer envelope.
The receiving agent sees its sender, `ovis-source://<send UUID>`, an explicit peer-content notice,
its return pane at send time, the unchanged original body, and an authentication footer in the actual submitted prompt.
The envelope identifies the Ovis display label as a label, not a registered Herdr agent name.
The reply address belongs to the sender's machine and Herdr server; its session name is included
only when the inherited socket matches that session's standard path. A custom socket never gets
a guessed session. Replies should omit `--wait` to avoid mutual waiting, and recheck a source that
moved or was replaced. Herdr
still receives one CLI invocation and one submission. The wrapper does not inject terminal output,
edit native transcripts, retry a send, or grant the peer human permissions.

Chat responses carry only the send ID, sanitized historical display name and authenticated source
agent kind, never private daemon or process identities. Older responses without a kind keep their
name and source action without an icon. This remains safe through older Ovis managers that forward remote conversations using
a driving bridge credential. Ovis projects an exact authenticated envelope in a single user text part into a **Message from [source agent icon] source name ↗** marker and the original body. It never joins ordinary chat rows to Graph receipts,
names, similar text or nearby timestamps. Separate sends have separate UUIDs even with identical
bodies. A verbatim copy of an authentic envelope retains its original peer-content provenance
and UUID: stock native transcripts do not prove whether that row is a direct delivery or a
copy. The marker therefore describes authenticated content, not a new delivery or human
instruction. Altered, malformed, unsigned, unrecognized and historical plain messages stay as
recorded. Native tools that normalize, split, summarize or truncate the envelope may prevent
structured chat attribution; their terminal still shows what Herdr delivered.


The sender name uses the source pane's explicit label, then its explicit tab label, then Ovis's
meaningful agent conversation title, then its locally shared Ovis `tab_labels` entry, then Herdr's
registered agent name, then the agent kind. The title and first-message shortening rules are the
same pure helpers Ovis uses for tab names. Automatic names are skipped when the shared
`autoTabNames` setting is off. Labels are sanitized and bounded; labels containing path separators are excluded, including
relative paths and endpoint locators. This also excludes slash-separated custom titles. The shared-label lookup uses the local pane ID **and stable terminal ID**;
another PC's keys and a replaced terminal's labels cannot name this sender. Managed installation
binds the wrapper to that Ovis server's state directory; a manual install can use `--display-state`.
No Ovis server needs to be running to read these files. Browser-only labels learned while reading
a transcript, or labels held only on another PC's Ovis server, are unavailable to the shim. For a
split tab, the actual source pane supplies an automatic name, not its sibling's. Thus this matches
those supported Ovis naming inputs, rather than promising every browser's current sidebar text.
Renames affect later sends; old receipts retain the authenticated name at send time, and navigation
continues to follow stable terminal/process proof. The source icon is the authenticated sender's
agent kind, independent of the recipient. The friendlier wording does not assert a new delivery or
human permission, including when someone copies an authentic envelope.

The terminal locator and chat source button work inside Ovis, by mouse or touch. They first read
the registered message metadata from the receiving PC, then ask connected PCs for fresh shim
process proof. The source must match the original server identity, daemon incarnation, stable
terminal and agent process instance. A moved source opens its current workspace/tab; a closed,
replaced, disconnected, ambiguous or unavailable source stays attributed but cannot open an
unrelated terminal. Opening changes only browser selection, never Herdr focus, input or attachment
ownership. The locator embeds no hostname, browser origin, credential or arbitrary destination;
it is inert outside clients that understand it. Watching devices retain the terminal text but
cannot read the private message-source lookup or process-resolution APIs.

This works at send time while Ovis is down. It covers the strict supported local/named-session
prompt syntax through the enabled wrapper on Linux/macOS. If envelope expansion hits exec's
argument limit before a child can execute, the original argv executes once as passthrough, without
a peer receipt. A started command is never retried. Unknown flags or ambiguous argv pass
through unchanged. `agent start` remains observation-only; native subagents, direct real-binary
or socket calls, Windows and `--machine`/`--remote` forwarding do not acquire envelopes. A saved
remote PC can show attributed messages sent by its own installed wrapper, once its Ovis bridge
supports these routes; forwarding to it from another PC remains a bypass. Cross-session source
navigation requires that source session to be represented by a connected Ovis PC.

`server/message-sources.ts` owns a separate additive `messages/` directory beneath the CLI journal:
a private 32-byte authentication `key`, and immutable version-2 `<send UUID>.json` receipts with
`version`, `id`, `source`, `target`, optional `display_name`, optional `reply_session` and `proof`.
Version-1 receipts and envelopes retain their original authentication and rendering. Endpoints include daemon/terminal/process identity
and registration labels. `display_name` is a separate immutable send-time display snapshot, also
authenticated by `proof`; it never changes endpoint identity. Receipts without it retain their
original authentication and registration-name fallback. `proof` authenticates metadata only. No prompt text, native arguments,
terminal output or body hash is persisted there. The body authenticator travels only in the
native prompt/transcript. The wrapper stages a private signed `<send UUID>.pending` intent before
launching the CLI, containing receipt metadata, the caller's socket and the wrapper configuration
path, without prompt content. Pending intent alone supplies no attribution or navigation. When
an owned native transcript contains its exact authenticated envelope, the conversation reader can
publish the receipt after rechecking both original agent instances and enabled tracking. Scrollback,
changed bodies and replaced endpoints cannot promote it. Thus `--wait` can keep waiting for agent
status without delaying a received message's attribution. The wrapper also retains its original
post-CLI publication path and removes pending intent on normal exit or handled cancellation.
Graph operation receipts still wait for the CLI result. Storage failure, collection disabled before
confirmation or ambiguous evidence leaves the ordinary envelope visible. Nothing is replayed to
repair such a gap. This is local provenance evidence, not a security boundary against programs
with the same account's filesystem access.

Graph journal and registry formats are unchanged. Older Ovis releases ignore `messages/`; they
cannot erase it in unrelated writes and render native envelopes as ordinary text. Deleting the
new proof files removes structured attribution/navigation but leaves native transcript content.
Wrapper `config.json` keeps version 1 and adds optional `bundle_revision: 4` and `display_state`
(the local Ovis state directory). Older wrappers ignore these fields; older setup writers may omit
them, causing the new status reader to request explicit setup again. A changed state directory
also requires an explicit refresh. Status checks never refresh code. Managed setup stages a new bundle only on explicit enable,
preserves the real executable and command path, and disables collection during replacement.
Manually installed wrappers use a fresh directory and an explicit PATH change as before. Disabling
tracking keeps inherited wrappers working as passthrough; it retains existing metadata. Rolling
Ovis back requires no data migration; remove the wrapper PATH entry or disable tracking to return
to original prompt bodies. Never delete native transcripts as rollback.
