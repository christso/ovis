# Separate native Codex stores

Base: upstream `74dfea3e72de1f26a07e9028aef77d8f77396e67`.
Final application commit: `f3a40126`.

The initial two distinct-store tests failed on upstream, while five conservative controls
passed. The first patch passed all 144 process tests; see `red.log` and `green.log`.

Independent review then caught a remote-client edge case: a `codex --remote` client's local
CODEX_HOME cannot prove where its app server stores the conversation. Four additional
controls failed against the first patch because it removed the remote pane's ownership
veto; see `remote-red.log`. These are failures of the first patch, not of pristine upstream.

The final patch retains remote peers and avoids filtering from an own remote client.
The tests cover both `--remote URL` and `--remote=URL`. All 148 process tests pass,
with 450 assertions; see `remote-green.log`.

The tests use real owned fixture processes, temporary stores, synthetic foreground metadata
and fictional transcript text. No Codex model or remote server is invoked.
