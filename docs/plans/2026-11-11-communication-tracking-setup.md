# Communication tracking setup

Users enable the existing Herdr CLI observation wrapper from Settings → Agents on the selected PC. No terminal command or PATH editing is required. The confirmation explains the shell files affected, that existing agents need relaunching, and that only CLI traffic through the wrapper is observed.

The design follows [Zed's in-app CLI installation](https://github.com/zed-industries/zed/blob/main/docs/src/macos.md#installing-the-cli): one explicit app action manages the command-line integration. Ovis needs an additional confirmation because activation adds a managed block to shell startup files. It leaves the original executable and non-Herdr terminals alone.

## Contract

- `GET /api/agents/communication-tracking` reports the shared `CommunicationTrackingStatus` for that PC, with no writes.
- `POST` enables, installs the standalone wrapper, configures startup files and verifies a newly started shell resolves `herdr` to the wrapper. Installation alone is not an enabled state.
- `DELETE` disables collection and removes only exact managed startup blocks. A passthrough wrapper remains usable by existing agents that inherited its PATH.
- All mutations require owner access and the app's explicit request header, also through local aliases and remote proxies. Watching devices cannot read setup paths. Unsupported platforms, shells and older remote bridges show an actionable status instead of success.
- Install state belongs to the machine user's private tracking directory and survives Ovis restarts. Operations serialize and preserve unrelated shell-file edits. Partial failures remain visible and can be disabled or retried.
- Linux/macOS Bash, Zsh and Fish use their real startup paths, including login Bash and custom config directories. No daemon restart or input into existing panes.
- Installed remote bundles include the installer. Stock Herdr CLI capture still excludes remote CLI flags and calls that bypass the wrapper.

## Work

1. Freeze the small shared status contract. Then build backend installation/lifecycle and frontend settings against it in disjoint files.
2. Exercise installation, actual shell lookup, repeat enable/disable, preservation of user edits, rollback/conflicts, stale agent passthrough, unsupported environments and authenticated/proxied HTTP contracts using isolated homes and state.
3. Run desktop/mobile setup interaction checks and relevant Settings browser regressions in the CI runner image. Run `bun run check fast`, simplify, review the integrated change, and publish a verified PR.

No activation on the maintainer's own machine is part of validation. Tests use temporary homes, an isolated Herdr session and disposable installation paths.
