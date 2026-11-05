# Native dogfooding: temporary duplicate messages

The follow-up uses the real Codex 0.166.0 TUI, a real isolated Herdr 0.9.5 session, the Ovis production server/client, and Codex's actual transcript. No transport failures, terminal acknowledgement failures or transcript records are fabricated in these native runs. The clock experiment deliberately simulates a browser clock two seconds ahead and delays its initial conversation request; these environmental conditions are stated rather than treated as an unmodified live-session reproduction.

Source is `62db905689ef32ee8fc883c78e3b110838835a5b`. The relevant placeholder, card and steering code is unchanged by PR #2792 relative to its upstream base. The deployed fork's steering loop has the same confirmation behavior, although upstream has a broader footer recognizer.

## Findings

| Symptom | Native observation | Assessment |
| --- | --- | --- |
| Faded duplicate | With a browser clock +2 seconds and no initial conversation baseline, one native user turn and its answer coexist with a faded copy. The aligned-clock control and the +2-second control with history already loaded do not duplicate it. | Confirmed placeholder reconciliation defect under these conditions. |
| Separate Not confirmed card | Four fresh native sessions each deliver a queued follow-up once, but explicit Send now produces an uncertain saved card. No fault is injected. | Real post-send confirmation problem and misleading recovery presentation. It does not demonstrate duplicate or lost delivery. |

The user subsequently confirmed using Send now for the local reported card. The matching action, Codex version, approximately two-second refusal, delivered native message and warning card make this a strong explanation of that live experience. Its original error code was not retained, so the historical request is not claimed to be conclusively identified. The faded live report's original first-read baseline was also not captured.

## Faded placeholder

- [Native MP4](native-faded-clock.mp4), [screenshot](native-faded-clock.png), [after reload](clock-after-reload.png).
- [Aligned-clock control](control-clock-aligned.mp4).
- [Clock-ahead control with loaded history](control-clock-ahead-loaded.mp4).
- [Results](clock-results.json), [reproduction script](reproduce-clock.ts).

All three cases use actual Codex transcript responses. Only the browser clock and the timing of its initial read differ. Every case has exactly one submit and one corresponding native user turn. The failed case retains one faded bubble even after the native answer is visible. Reload removes it with zero further submits.

The causal path is `src/lib/sentWaiting.ts:64–73`: without a baseline, a precisely timestamped user turn must be at least the browser's send time. A sufficiently faster browser clock violates that assumption. The whole-second allowance does not apply. The faded message therefore does not settle, while the actual turn is independently rendered. The existing five-second clock hint and 60-second expiry are presentation timers, not delivery evidence. The initial demo recording elsewhere on this branch shows expiry; this native recording shows earlier removal on reload.

A repair needs to preserve repeated-message and one-turn-per-send guards. Merely accepting arbitrary matching text, or adding an unconditional clock tolerance, could associate an older identical message with a newer send. Existing `src/lib/sentWaiting.test.ts` is the test home for those identity and timing rules; the browser case checks the actual visible duplicate and should accompany it.

## Send now confirmation

- [Native MP4 including reload and dismissal](native-send-now.mp4).
- [Warning card](native-send-now.png), [card retained after reload](after-reload.png), [after dismissal](after-dismiss.png).
- [Instrumented protocol/results](send-now-results.json), [trial summaries](native-trials.json), [reproduction script](reproduce-send-now.ts).

The final complete run records this chain:

1. The browser queues one follow-up, then explicitly selects Send now.
2. The production bridge pastes it and awaits the real Enter RPC successfully.
3. `interruptCodexSteering` polls for at most 1.5 seconds. All 21 recorded reads report Codex working and no matching steering panel. No Escape is sent.
4. The helper throws `Codex immediate delivery was not confirmed. Check the terminal before sending again.`
5. `server/core/pending.ts:719–751` folds that post-write exception into `submit_changed` and settles the retained row as uncertain.
6. Codex's actual transcript contains the user message once and its corresponding ACK. The browser still shows the saved Not confirmed card.

The final run only wraps the helper's existing IO to record the reads and original exception; it does not change return values, inject an error or add waits. Three earlier fresh native runs reproduced the warning without that instrumentation.

[The original Send now PR #783](https://github.com/devswha/ovis/pull/783) and `docs/development.md` intentionally require the exact native panel before sending Escape. That safeguard should stay. Acknowledged terminal input, native acceptance, and guaranteed immediate interruption are distinct outcomes. The current broad uncertainty state conflates them. In this bounded run native acceptance and a reply are observed; immediate interruption is not proven.

After reload the card remains. It offers Copy and Discard saved copy, with no Send now action. Dismissing it removes the saved card, keeps all three native user turns, and sends no new submit. An exploratory continuation also confirms that an unresolved uncertain row blocks another queued message with `pending_uncertain`; that safety fence is intentional, but the visible warning does not clearly explain how to resolve it.

Existing coverage should remain in `server/codex-steering.test.ts`, `server/pending-input.contract.test.ts` and the pending-message browser flow. Add the case where Enter succeeds and Codex consumes the input while remaining working, without exposing a pending steering panel. Those seams can verify acknowledgement/confirmation separation, retained safety fences and no resend; they do not alone prove behavior against a future native Codex release.

## UX recommendations

Both symptoms deserve improvement even where the safety behavior is deliberate:

- For a confirmed terminal write whose immediate interruption could not be verified, report that narrower fact: **Sent to terminal · immediate interruption not confirmed.** Do not claim immediate processing or that nothing was sent.
- For genuinely unknown delivery, use **Saved copy · delivery unknown**, explain that it may already have arrived, and state that it will not resend automatically.
- Add **Open terminal** beside the warning and make **Dismiss saved copy** understandable without hovering. Explain that dismissal does not cancel or remove the message already in the agent conversation.
- Explain when queued sending is paused until the copy is reviewed/dismissed. The recorded later refusal establishes that this affects the user's next action.
- Avoid making a recovery copy look like a second queued send. The mixed list is currently labelled **Queued messages** to assistive technology; **Message status** would describe uncertain copies more accurately.
- Keep Copy as copy only. Preserve exact receipt authority and the prohibition on automatic resend; transcript text similarity is insufficient to settle uncertain input.

These recommendations follow the observed action/recovery problems and the [Carbon actionable notification pattern](https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines), which pairs contextual feedback with a useful action. This is a usability assessment of bounded desktop checks, not a physical-phone or screen-reader user study.

For diagnosis, also retain the failure phase and error code alongside request/pending IDs, without logging message text or credentials. The current client trace's generic ok/refused result concealed the distinction between a failed write and failed post-write steering confirmation.

## Validation and limits

`bun run check fast` passed again on the unchanged source: 11,250 unit tests, zero failures, 44 repository skips, plus generated-file, workflow, type and build checks ([summary](fast-check-summary.txt)).

Four independently launched native sessions each reproduced one Send now warning after one delivered follow-up. This is four bounded reproductions, not a general failure-rate estimate. The original native workflow and final lifecycle script completed. Two exploratory repetitions captured a valid first Send now reproduction but did not finish their subsequent workflow: one correctly hit the unresolved-row queue fence, and one hit an automation race attempting to dismiss a row again while it was being removed. They are not represented as green complete runs.

Three ordinary idle sends in the first native workflow and the idle controls in subsequent sessions produced one native user turn apiece, with no persistent faded or uncertain copy. The attempted auto-drain case in the first workflow was answered as an immediate send, so it is not claimed as an exercised queued auto-drain.

The three clock cases and final native lifecycle completed with zero browser page errors. All runs use loopback, temporary application state, a separate Herdr session and a disposable Codex home. They use an existing Codex sign-in copied privately into that home; credentials and raw auth/config files are excluded from the artifacts. The workspace is read-only for the native agent, and all native prompts concern only the fixture. Temporary native stores and owned sessions are cleaned up afterward.

Bun 1.4.3, Node 26.7.0 and the Node PTY fallback were used. Native Windows, macOS, physical phone, screen-reader interaction, remote OMP native reproduction and a long soak are untested. The original user's exact historical first-read and refusal records remain incomplete. No application fix or change to PR #2792 is included.

From a logged-in Ovis checkout with dependencies and the client build available:

```sh
OVIS_REPO="$PWD" bun run check run bun /path/to/reproduce-send-now.ts
OVIS_REPO="$PWD" bun run check run bun /path/to/reproduce-clock.ts
```

Do not run the two check commands concurrently in one checkout. The scripts require native Codex and Chromium at the documented local path; adapt that executable path for another test host. Their original videos are WebM; MP4s on this branch are H.264 conversions.
