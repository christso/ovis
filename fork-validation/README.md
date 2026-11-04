# Fork validation alignment

Tested application revision `4fda6ca101b0209c83bbc8f1a71dd025ebb0fbc9`, based on fork default `e6f3016d`.
No new runtime defect was found: the installed fork already has the approved scoped
receipt recovery algorithm. This follow-up changes two test files only.

The bridge fixture uses an explicit token instead of the bridge registry, checks
that sent/discarded/late reconnect recovery adds no herdr writes, and covers
malformed receipt IDs through the relay. Existing late-receipt coverage is retained.

- Focused relay + pending contracts: 132 passed, zero failures.
- Fast gate: 10,611 passed, zero failures, 41 repository skips; workflow syntax,
  generated files, typecheck and build passed.
- Isolated built-browser + real relay/bridge smoke test: passed. The exact resumed
  sent receipt clears Not confirmed with no new terminal bytes or submit; draft preserved.
- Read-only lite review: no findings.

This is automated fixture evidence, not native-agent/live-device dogfooding.
The browser test uses a synthetic Codex recorder and an injected PC roster/endpoint;
real OpenSSH was separately exercised on upstream PR #2792, not repeated for this test-only fork change.
Full integration/browser lanes and native Windows/Mac were not run.
