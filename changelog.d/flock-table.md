### Added
- Table view lists agent executions across configured machines with sorting, filtering and optional
  machine grouping. Explicit work/session associations keep their identities through renames and
  restarts, and stale or disconnected executions remain visible without opening a recycled pane.

### Fixed
- Table requires verified native ownership before associating or opening a session. Codex thread
  hints reported by a shared daemon cannot bind another pane's conversation; unproven sessions
  remain visible without an action.

### Changed
- Phone Table rows show session names, status, machine and actions together in compact cards, with
  full metadata in execution details and touch-sized sorting, filtering and association controls.
