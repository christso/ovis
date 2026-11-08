# Work and session registry

Flock opens a force-directed graph of recorded repositories, worktrees, sessions and agent tabs.
Ovis's native Agents section remains the single agent list and keeps its existing filters. The
old Table view and association/work-renaming/Move controls are retired from navigation; the
registry, existing associations and migration APIs remain intact. Legacy `page=table` links open
Graph. Open in Workspace resolves the selected node's verified current target without focusing
Herdr or sending input.

Repository colours follow reported physical membership. Native repository names keep colours
consistent across machines; unknown membership stays neutral. Names use existing native tab
labels and launcher metadata without reading transcripts or inferring session identity. Dragging
moves linked neighbours; the simulation stops when settled. Fit/Reset are intentional framing
actions, and polling does not move an idle graph.

Each logical session has its own ID and a current execution ID. An execution records the machine,
Herdr lifetime, pane, agent kind and native session ID. A later execution can belong to the same
logical session on another machine; its earlier executions remain separate nodes. This records an
association only. It does not transfer or restore anything.

A registered execution is live only when its entire binding matches the connected machine's roster.
Disconnected, missing and replaced sources remain visible without a terminal target. An unadopted
pane whose bridge cannot prove its Herdr lifetime or whose agent reports a path instead of an ID
shows **Identity unavailable**. Native Workspace/Agents controls remain available. Graph opening
requires either exact current Herdr occupancy or independently verified native ownership.
Repository and branch metadata appear only when known. Live branch labels reuse the sidebar's
Git reader. A recorded checkout is physical metadata, not an inferred global repository identity
or a promise that it still exists on disk. Graph coalesces observations of the same concrete
machine/path/repository while keeping execution and session IDs separate.

The manager serving the configured roster owns `flock.json` in its Ovis state directory. The writer
is `server/flock.ts`; the shared contract and pure roster projection live in `shared/flock.ts` and
`shared/flock-inventory.ts`. Graph and the retained migration APIs share this inventory. The document
is new in this feature, with no previous shape to migrate:

```ts
{
  version: 1,
  revision: number,
  works: FlockWork[],
  sessions: FlockSession[],
  checkouts: FlockCheckout[],
  executions: FlockExecution[]
}
```

This release reads/writes version 1. Earlier releases know nothing about this separate file and do
not rewrite it. Disk and API readers share the validator in `shared/flock-schema.ts`. Unknown API
formats leave the rest of the app working and disable registry writes until a supported reload. An unknown version, malformed record or broken reference refuses reads and writes
without replacing its bytes. Writes use the existing private temporary-file/rename helper. Each
mutation rereads the document and checks its revision, preventing another browser's stale change
from replacing newer work. There is no distributed synchronization or automatic recovery from a
lost manager. Back up the manager's state directory to keep these associations.

The authenticated manager API is `GET /api/flock` and `POST /api/flock` with
`{ revision, command: FlockCommand }`. Both return the registry and `Cache-Control: no-store`.
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
An endpoint without an unambiguous logical association remains an observed native session or
Herdr occupancy, with no assumed live terminal target or root-agent status.

Capture currently supports Codex's durable completed `SubAgentActivity` receipts with an own-thread
ID, native target ID and a successful `started` or `interacted` activity. The source reader follows
the same verified rollout as native ownership, checks the source identity and reads complete records
within a bounded budget. Unsupported/legacy formats and earlier transcript segments may have no
coverage. The custom Herdr fork additionally records successful attributed CLI start/prompt
operations in its private daemon journal. Ovis reads its optional `agent.coordination.list`
extension in bounded pages and retains closed-agent history. The daemon's server, boot, terminal
and occupancy identities distinguish agents even when names or pane IDs are reused. A pane move
does not create a new agent relationship. This capture works across the CLI kinds Herdr recognizes;
it does not depend on parsing shell commands or message text. Stock Herdr has no such extension,
so its ordinary CLI commands remain unattributed. Missing support disables only that capture.
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
