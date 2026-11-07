# Work and session registry

Table is a flat view of agent executions across the configured PCs. Workspace and Agents keep
Herdr's existing navigation. Switching views preserves the selected machine/pane. The Workspace
selector is in the sidebar, including the phone drawer; Table and Agents keep a selector above their
content. Opening a live Table row selects that exact target using the existing browser selection
flow, without focusing Herdr.

Use **New work** to create a named work item. **Associate session** explicitly creates a logical
session for an agent execution, or records that execution against a session you choose by ID.
Equal names, paths and branches never merge records. **Edit association** renames the logical
session or changes its work item. **Rename work** changes a work item's label. Neither changes
the native agent session, files, pane name or execution history.

Each logical session has its own ID and a current execution ID. An execution records the machine,
Herdr lifetime, pane, agent kind and native session ID. A later execution can belong to the same
logical session on another machine; its earlier executions remain separate rows. This records an
association only. It does not transfer or restore anything.

A registered execution is live only when its entire binding matches the connected machine's roster.
Disconnected, missing and replaced sources remain visible without a terminal target. An unadopted
pane whose bridge cannot prove its Herdr lifetime or whose agent reports a path instead of an ID
shows **Identity unavailable**. Its usual Workspace/Agents controls remain available. Table cannot
adopt that pane or use it as a move source. Rows include execution/native IDs and the checkout path
under **Execution details**. Repository and branch metadata are shown only when known; an em dash
means unknown. Live branch labels reuse the sidebar's Git inventory reader. A recorded checkout is
physical metadata at adoption, not a globally inferred repository identity or a promise that it
still exists on disk. Repeated adoptions record independent checkout observations.

The manager serving the configured roster owns `flock.json` in its Ovis state directory. The writer
is `server/flock.ts`; the shared contract and pure roster projection live in `shared/flock.ts` and
`shared/flock-inventory.ts`. Table and future Graph/Move consumers share this inventory. The document
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

Table's execution details show read-only delegation and communication relationships. The manager
collects successful native coordination receipts alongside verified source inventory and retains
only session IDs, event IDs, relationship kinds and occurrence times in the optional `observations`
array of `flock.json`. Repeated polling does not add events or increase message counts. Historical
execution bindings resolve endpoints to logical sessions, preserving links through a planned move.
Native receipt identity is independent of its capture machine, so replay after copying a rollout
does not count another message. The first capture's machine provenance is retained. Older stored
duplicate captures remain readable and are counted once in both views.
An endpoint without an unambiguous logical association remains an observed native session, with
no assumed live terminal target or root-agent status.

Capture currently supports Codex's durable completed `SubAgentActivity` receipts with an own-thread
ID, native target ID and a successful `started` or `interacted` activity. The source reader follows
the same verified rollout as native ownership, checks the source identity and reads complete records
within a bounded budget. Unsupported/legacy formats and earlier transcript segments may have no
coverage. Plain Herdr CLI start/prompt operations do not publish caller identity in this protocol
and cannot be attributed. Other CLIs, prose mentions and unsuccessful requests create no links.
Older bridges that do not publish coordination observations contribute no automatic agent links.
The inspector does not expose message contents. Its counts describe recorded receipts, not delivery
acknowledgements or a complete communication history.

There is no manual agent-link editor or browser relationship mutation command. Existing work
membership and execution/session association remain identity operations. Observations are passive:
they do not alter prompts, send messages, assign work, grant control or block execution. Table and
Graph consume the same recorded relationships.

The native format is pinned to [Codex0.166's activity item](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/protocol/src/items.rs)
and [successful message dispatch](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs).
Watch-only devices cannot read the registry or coordination inventory through either direct or
per-machine proxy routes.
