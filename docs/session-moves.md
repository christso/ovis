# Planned Codex session transfer

Implementation of fork issue #20 is in progress. The dedicated `server/session-move/`
modules supply transfer primitives and recovery; they are not yet connected to Table,
HTTP dispatch or an Ovis dialog. No production transfer action is available from these
modules alone. Integration depends on issue #19's logical identity model being merged.

This is a planned move while the source PC is available. It does not continuously
replicate a conversation and cannot recover an unexpectedly lost PC.

## Native support and limits

The qualified format is Codex CLI **0.166.0**. Source and destination must use exactly
that version. Linux has an installed-CLI, disposable-home round-trip test. The writer
lock implementation also supports macOS, but a native macOS round trip has not been
run. Windows transfers and other versions are refused by compatibility preflight.

An eligible source has finished its turn and exited its native Codex client. A loaded
idle thread still owns its native writer lock. Ovis cannot safely stop that client
through the supported API: `thread/unsubscribe` affects the calling connection only,
and `thread/archive` has no idle-only guard and may acknowledge after a shutdown timeout.
The implementation therefore refuses a loaded source. It sends no guessed keys,
interrupt signal, pane close, takeover or shared-daemon shutdown. After native exit,
the exact thread writer lock is acquired and held during snapshot, restore and resume
verification, coordinated with Codex's own `.coordination.lock`. Other threads are not
stopped. Recovery must re-establish that ownership before continuing.

Supported snapshots contain ordinary Git checkouts and native plain JSONL rollouts,
including paginated/reverted history. Submodules, symbolic links, unresolved Git
conflicts and Git content filters are refused. The destination checkout is new,
private and detached at the source HEAD. Its commits arrive in a self-contained Git
bundle. Separate binary patches preserve the Git index and working tree. Only
individually selected, non-ignored untracked files are included; excluded files must
be listed in the preview. A snapshot is limited to 256 MiB per checkout/native artifact
set. Native history proof is limited to 64 MiB and 4096 pages per collection.

Inline pictures remain in the rollout. Local picture references must resolve to real
files inside the source checkout and be included in the checkout snapshot. Sessions
with those references currently require the same absolute checkout path at the
destination; byte-exact native history is not rewritten to relocate them. Stored file
attachments, external image URLs, realtime artifacts, attached forks, subagents and
custom runtime capabilities are refused. Authentication and runtime requirements are
preflighted on the destination; source credentials, configuration homes, SQLite auth
records, hooks and Git remote configuration are never copied.

## Why the native artifact closure matters

The implementation was checked against the installed CLI's `resume --help`, generated
app-server types and upstream `rust-v0.166.0` persistence sources. The native mechanism
is `codex resume <thread UUID> --cd <checkout>`; the verification fixture uses the same
native app-server `thread/resume` operation without starting a model turn. Official
[CLI reference](https://learn.chatgpt.com/docs/cli/reference) documents native resume.

A paginated rollout's `session_meta.history_base` names an inherited file by its
**rollout ID**, exclusive record ordinal and byte offset. The field called `thread_id`
in that bookmark can differ from the stable conversation ID after a revert. Resolving
by the stable ID, filenames alone, record count or modification time can select the
wrong history. Record ordinals can contain gaps. Missing, ambiguous, cyclic or invalid
boundaries are refused.

Referenced rollout files are copied byte for byte, including their full tails. The
preview must disclose that referenced files can contain discarded/reverted turns beyond
the selected lineage's bookmark. Native replay keeps those boundaries; files are not
flattened or silently converted to another history mode.

Codex's paginated history API additionally needs the associated `thread_history_1.sqlite`
projection rows. A native probe established that UUID-only resume can otherwise succeed
with empty inherited history pages. The snapshot exports only rows keyed by the required
inherited rollout IDs from `thread_turns`, `thread_items` and
`thread_history_projection_state`. It does not copy a whole shared SQLite database.
Source reads use a consistent read transaction. Destination import compares the exact
schema and eight migration records, rejects existing rows for those rollout IDs, and
appends in one transaction. The installed destination CLI initializes its own schema
before the import. Realtime history and incomplete projection coverage are refused.

Before binding, verification requires the same native thread/session IDs, selected
rollout, destination cwd and a loaded runtime, plus a checksum of **every** native turn
and item page matching the source proof. No prompt is sent to verify it.

## Recovery and integration requirements

`MoveJournal` owns a new private state document, `session-moves.json`, version 1.
Older Ovis releases neither read nor write it. Unknown versions or malformed records
remain byte for byte and refuse writes. Atomic private-file replacement persists an
intent before each external operation. No existing browser or bridge store is migrated.
The document currently has no public HTTP contract; that belongs to the pending
integration.

A source snapshot is retained on failure. Restore and native launch are distinct steps.
If a connection fails after launch, retry inspects the operation's destination receipt;
it does not launch another pane, resend input or automatically restart the source.
An absent/unknown destination remains unresolved until reconciled. Binding is committed
only after native verification, using Table's expected-current-execution comparison.
A crash after binding is reconciled against the exact destination execution rather
than appending another execution. Logical names and work associations stay in Table's
registry; this module does not create a second session registry.

The machine adapter must use configured `MachineManager` endpoints, verify transfer
capabilities and destination conflicts before source ownership changes, and implement
operation-owned snapshot/restore/launch receipts. It must never accept arbitrary SSH
hosts, target URLs or shell commands from a transfer request. The supplied transport
uses a fixed bridge route, redirect rejection, bounded requests/responses and private
error messages. Its node dispatch, registry adapter and UI wiring are pending Table
integration. Existing bridges without transfer capability must fail preflight, not be
updated as a side effect of moving a session.

## Validation

Run fixture coverage through the supported isolated runner:

```sh
bun run check run bun test ./server/session-move
OVIS_CODEX_MOVE_NATIVE_TEST=1 bun run check run bun test ./server/session-move/native.contract.test.ts
```

The second command requires the installed 0.166.0 CLI. It creates and removes its own
source/destination homes, invokes only owned app-server processes, inherits no API keys
or credential homes, and never calls `turn/start`. Without the flag, native qualification
is skipped rather than touching an installed user's sessions.
