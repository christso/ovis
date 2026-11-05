# Fork improvements: red and green native runs

**Deployed follow-up: [both native green recordings and installed-build verification](deployed/README.md).** The later packet records the exact installed combination and keeps the baseline experiments below for comparison.

Both symptoms were reproduced again on fork base `e6f3016d3e2e8f912a3c87570b2f9211a0844e82`, independently of the upstream receipt PR. The native runs use Codex 0.166.0, Herdr 0.9.5, actual transcripts, isolated application state and a disposable native home. No delivery failure or transcript record is fabricated. The clock cases explicitly simulate a browser clock two seconds ahead and hold its initial conversation request until after submit.

## First-read sent status

| Same native scenario | Before | After |
| --- | --- | --- |
| Clock aligned | One submit, one native user turn, zero faded copies | Same |
| Browser +2 seconds, history already loaded | One submit, one native user turn, zero faded copies | Same |
| Browser +2 seconds, initial history read held | One submit, one native user turn and answer, one faded duplicate | One submit, one native user turn and answer, zero faded duplicates; one compact sent-status disclosure |

[Red MP4](red-first-read.mp4) · [Green MP4](green-first-read.mp4) · [Green screenshot](green-first-read.png) · [Red results](red-clock-results.json) · [Green results](green-clock-results.json) · [Harness](reproduce-clock.ts).

The green source tree is `bfe96686f653582b0b377885593efc2fb1717c8e`, committed as [`99c4549e912a4ecb9701eaa5ebfc4f332c0b8224`](https://github.com/christso/ovis/commit/99c4549e912a4ecb9701eaa5ebfc4f332c0b8224). Matching and the 60-second expiry are unchanged: first-read ambiguity cannot safely distinguish an older identical message. The repair retains compact status and expandable original text instead of presenting a second full message. This is a presentation repair, not proof of native-turn correlation. Reload submits nothing again. All three green desktop cases have no horizontal overflow or browser page errors.

Proof-first component tests failed twice before the change, then passed. The final focused run passed 73 tests. `bun run check fast` passed: 10,615 tests, zero failures, 41 repository skips, plus type, build, workflow and generated-file checks. A completed code review found no issues. Integration/browser CI and installed-build verification are recorded separately when complete.

## Send now baseline

[Red native MP4](red-send-now.mp4) · [Red results](red-send-now-results.json).

The unmodified fork delivers the follow-up once and records its native ACK. Enter acknowledges, then all 21 existing confirmation reads report working and no matching steering panel. No Escape is sent; an uncertain full saved copy appears and survives reload. Dismissal sends no new submit. Green evidence follows with the separate fork improvement.

The previous [native investigation](../native-dogfood/README.md) records the causal chain and historical-report limitations. These tests establish bounded native scenarios; they do not identify the original user's missing first-read baseline. No physical-phone, remote OMP, native Windows/macOS or sustained-soak claim is made.
