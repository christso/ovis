### Fixed
- Clear a Codex send's saved “Not confirmed” copy when its bound native transcript records a unique
  new matching user message, including receipt recovery after reconnect. Confirmation sends no
  input, creates no duplicate sent bubble and leaves later held messages held.
### Changed
- Restore upstream's original recovery message and Copy/Discard controls; remove the fork-specific
  recovery card, compact controls and browser-side transcript matching.
