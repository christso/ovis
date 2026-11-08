### Added
- Table execution details show automatically recorded Herdr and Codex delegation and communication, with
  recorded counts and activity times retained across refreshes and planned machine moves.
- Table view lists agent executions across configured machines with sorting, filtering and optional
  machine grouping. Explicit work/session associations keep their identities through renames and
  restarts, and stale or disconnected executions remain visible without opening a recycled pane.

### Fixed
- Table requires verified native ownership before associating or moving a session. A current Herdr
  agent can open through its exact runtime identity. Codex hints reported by a shared daemon cannot
  bind another pane's conversation; unavailable or replaced agents have no terminal target.
- Automatic relationships recover after Herdr replaces a journal with shorter history, and repeated
  endpoint lookups are shared within each refresh as relationship history grows.

### Changed
- Phone Table rows show session names, status, machine and actions together in compact cards, with
  full metadata in execution details and touch-sized sorting, filtering and association controls.
