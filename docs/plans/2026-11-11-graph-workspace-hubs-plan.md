# Workspace hubs and a collapsible bottom legend

## Goal and settled design

Show actual native workspace, worktree and tab nodes. Colour by those three kinds, following
Folio's category colouring. Use workspace → worktree → tab for linked worktrees (user-directed);
regular tabs connect directly to their workspace. Structural links create natural clusters;
communication links remain separate recorded evidence. They retain communication-only node sizing.

Plain folders are real workspace hubs without requiring Git. A worktree whose main workspace is
not open remains an independent worktree hub; no parent is invented. Empty workspaces remain visible.
Hub navigation resolves only the hub's own current verified tabs, with no Herdr focus or input.

Keep machine clouds and optional machine grouping. Move the three-kind legend below the canvas,
cap its height with scrolling, and persist its keyboard-accessible disclosure state.

## Implementation

- Project native hubs, typed structural edges and legacy workspace-focus groups from the same
  native grouping the sidebar uses. Preserve exact tab/occupant identity and target guards.
- Use stronger short hierarchy springs and weaker longer communication springs; root hubs repel
  enough to keep their child groups separate. Preserve connected dragging and settled polling.
- Save layout and legend state in `ovis:graph:v2`, owned by graphState/useGraphState. On first use,
  derive selection, filters and machine grouping from v1, then recluster and fit once.
  Preserve the original `ovis:graph:v1` bytes. Old tabs and rollback releases keep using v1;
  new tabs write only v2. Unknown v2 formats remain unwritable. Neither store uses HTTP or WS.
- Update translations, current design/docs and a changelog fragment.

## Verification

- Test native hierarchy, plain folders, empty workspaces, orphan worktrees, guarded hub opening,
  type colours, communication-only radii and settled clustering without repository affinity.
- Test v1 migration, old/new writers side by side, rollback and unknown-v2 byte preservation.
- Run graph unit tests, fast checks and graph browser regressions in the CI runner image.
  Check desktop/phone legend placement, keyboard collapse, persistence, filtering and stable polls.

## Design references

Adapt Folio's category colouring and typed tree edges to Herdr's native hierarchy; follow Zed's
project grouping for separating work contexts. Ovis keeps its existing SVG renderer and controls.
No upstream code is copied.
