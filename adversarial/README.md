# Adversarial remote receipt behavior pass

This is a bounded automated browser/bridge fault-injection pass, **not real/native-agent,
real-phone or sustained live-use dogfooding**. No production server or live herdr pane was used
as a test target. The installed fork's immutable source/build and Rust PTY binary were used
with fresh loopback servers, isolated state/native-store directories and owned test panes.

Revisions:

- Upstream PR #2792: `62db905689ef32ee8fc883c78e3b110838835a5b`, Node PTY fallback.
- Installed fork source: `4fda6ca101b0209c83bbc8f1a71dd025ebb0fbc9`, installed Rust PTY host.
- Every result records both the Git revision and matching `dist/build.json` revision.

## Faults and expected behavior

The real built app queues a follow-up through a paired-device connection, a real connection
server, `MachineRelay`, and a real loopback bridge. A synthetic raw-input recorder stands in
for Codex. The PC roster/endpoint is injected; this browser pass does not test SSH transport
(the earlier standalone SSH integration does). The native Codex store is an empty temp folder.

Each revision gets the same desktop/390px phone-emulation matrix:

- Lost sent receipts with 0/30/120 ms closure delay, on desktop and phone.
- Reload with a lost receipt, and discarding the local uncertain copy before reconnect.
- Disconnect before delivery: the message remains unsent, even after the agent is ready.
- Invalid browser resume identity: a new valid UUID is made; no receipt is fabricated.
- Three refused reconnect attempts, followed by recovery.
- Another authenticated device, an observer and another PC scope using the same browser UUID:
  none receives the owner's receipt. Ordered ping barriers bound these negative assertions.
- Bridge restart and connection-server restart: the saved copy stays Not confirmed,
  offers Copy/Discard, offers no Send now, and causes no resend.
- Send clicked before the input lease: safely refused, draft preserved, no bytes typed;
  a later explicit retry succeeds.
- Six additional successful reconnects after recovery, each requiring a new socket generation
  and that generation's input-ready frame: no saved row returns, no submit/typing repeats,
  and the unsent draft and its DOM focus survive.

The connection-server restart case restores the fixture browser storage at the replacement
server's new ephemeral port; it is not a claim about a production origin/proxy restart.
Phone cases emulate viewport/touch; they do not exercise iOS suspension, a real mobile keyboard
or real background-network behavior. Negative no-input assertions observe bounded intervals
(250–750 ms), plus the protocol barriers and exact cumulative byte/submit counts.

## Initial harness characterization

The first stress harness assumed a queued row should exist as soon as the connection was live.
It sometimes clicked before `input-ready`. The server answered `input_not_ready`, then granted
the lease; the expected row never appeared. The retained characterization shows that order.
No production fix was made for this: normal recovery cases now wait for the actual input lease,
and the dedicated early-click case deliberately holds the attach and verifies the safe refusal,
kept draft and explicit retry. The repeated-reconnect probe was also tightened to bind each
readiness event to its new socket, rather than accepting an older socket's delayed frame.
Initial characterization runs are not counted as successful recovery trials.

## Artifacts and reproduction

See `results.json`, the per-scenario matrix, scripts and selected inspected screenshots.
The published scripts are the exact final probe implementations; the runners retain this
session's artifact paths. To exercise one scenario from a checkout of either pinned revision:

```sh
OVIS_QA_REPO="$PWD" OVIS_QA_CASE=bridge-restart OVIS_QA_PHONE=1 \
  OVIS_QA_EVIDENCE=/tmp/receipt-adversarial-one \
  bun run check run --build bun /path/to/adversarial/scenario.ts
```

Use `scenario-repeat.ts` with `OVIS_QA_CASE=repeat-resume` for the repeated successful
reconnect probe. The final summary checks every source/build binding and all count invariants.
No app code, PR head or deployed revision changed during this pass.

## Remaining limits

This does not establish sustained real-Codex/phone reliability. No paid model was invoked,
no live user session was exercised, no long soak was run, and receipt expiry/eviction was not
waited out in a real browser. Existing unit/contract coverage exercises those receipt limits.
Full browser/integration lanes and native Windows/Mac were not rerun for this evidence-only pass.

## Final result

**40 final scenarios passed: 20 per revision; zero final scenario failures.** The two repeated-resume probes each observed eight accepted socket generations (initial, receipt recovery, then six further reconnects). Every result had matching source/build revisions, unchanged terminal-byte and submit counts across reconnect, a preserved draft and zero page errors.

The initial invalid-readiness expectations and the first unspecific reconnect synchronization were characterized and replaced before this final result. No application fix was needed. Fast checks passed again before publishing: 11,250 unit tests, zero failures, 44 repository skips, plus workflow/generated files/typecheck/build.
