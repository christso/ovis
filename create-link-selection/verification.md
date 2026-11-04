# Creation links use their named PC

Base: `74dfea3e72de1f26a07e9028aef77d8f77396e67`.
Checkout: `$WORKTREE`.

The regression changes were applied and run before changing production code.

| Command | Before fix | After fix |
| --- | --- | --- |
| `bun scripts/palette-machines-demo-regression.ts` | Exit 1: expected New workspace · Build PC, got New workspace · Laptop | Exit 0; desktop, phone and all existing cases pass |
| `bun scripts/deep-link-demo-regression.ts` | Exit 1: missing-PC header note timed out for creation-only link | Exit 0; new local/missing-PC cases and all existing cases pass |
| `git diff --check` | Pass | Pass |

The palette command used `UI_EVIDENCE_DIR` pointing to the corresponding `red/` or `green/`
directory here. Screenshots use fictional demo fixtures. The red desktop capture and green
desktop and phone captures were opened and inspected. The green dialog names Build PC and
offers Codex, with no clipping in the phone sheet.

Fast checks, full suites, installs, commits, pushes and publication were not run by this worker.
The parent owns authoritative final verification and delivery. The scripts build only disposable
demo bundles and clean up their browser contexts and loopback servers.
