---
title: Received peer message attribution and source navigation
type: feat
date: 2026-11-12
---

# Received peer message attribution and source navigation

## Product contract

Future supported `herdr agent prompt` sends through the enabled Ovis wrapper identify the sending agent in the actual prompt. The original body remains intact inside a generated peer envelope. Ovis chat draws a compact sender marker and terminal text offers an origin-independent source locator. Opening a source changes browser selection only.

The shim invokes Herdr once. Unknown syntax, saved-machine forwarding, direct binary/socket calls, native subagents, starts and unverifiable callers remain unchanged. No historical text matching, native transcript mutation, fake PTY output, daemon restart or fork dependency is permitted. The feature ships as one ready PR against `christso/main` and stops there.

## Technical decisions

- Recognize a strict subset of prompt argv, retaining the body argument index and preserving all other arguments. Herdr remains responsible for submission, errors, output, signals and waits.
- Generate a UUID for each send. Persist a private metadata-only message receipt separately from Graph's terminal-level receipts. Record source and recipient daemon/terminal/process identities. Authenticate the exact envelope and body with a private local key; plain or edited imitation markers cannot become verified claims. A copied authentic envelope remains copied peer content, never human authorization.
- Only a successful submission with unchanged pre/post identities publishes a receipt. A killed shim or storage failure leaves the visible attribution but no verified chat marker/navigation. Never retry to repair missing evidence.
- Use `ovis-source://<send UUID>` as a locator interpreted inside Ovis against the receiving machine. It contains no origin, credential or arbitrary navigation target. Resolve live senders by stable terminal plus daemon and process proof across current machine snapshots; reject ambiguous, replaced, closed and disconnected sources.
- Enrich user turns at the common conversation response boundary only after receipt authentication against the receiving terminal identity. Do not infer attribution from timestamps, text resemblance or names. Preserve plain messages and old transcripts.
- Reuse terminal file-link logical-line mapping and touch handling for source locators. Use a shared source-opening context for chat and terminals. Unavailable links report their status without selecting a replacement.
- Refresh owned installed wrapper bundles only through explicit tracking setup, using a bundle revision and existing staged replacement. Reading status never rewrites an installation.

## Implementation units

### U1. Delivery and proof

Implement strict prompt parsing, envelope creation/authentication, metadata receipt publication, shim integration and deliberate wrapper refresh. Cover exact original body, one submission, parsing/passthrough, failures, concurrency, spoofing and disabled collection at the owning seams.

### U2. Presentation and navigation

Add response-only sender metadata and a read-only source lookup contract; authenticate user turns without changing native stores. Render the sender marker, support terminal/touch source locators and select current sources using complete identities. Test moved, replaced, closed, duplicate machine namespaces, malformed metadata and legacy messages.

### U3. Documentation and validation

Document scope, privacy, stored-format rollback and rollout. Cite Rakazo at commit `290bdc5e6af35670d9012628fd237e1f4f66bac4`: its structured bot messages, separate peer wake prompts and CollaborationMarker are a design precedent, not literal terminal-to-terminal routing. Implement independently; any adapted code would require Apache-2.0 notices. Run focused unit/contract checks, `bun run check fast`, and relevant chat/terminal/selection/focus browser regressions in `local/ovis-ci-upstream-sync:20261109`, with isolated fixtures and cache-backed TMPDIR. Simplify, obtain an independent review, resolve retained findings, then commit and push together and open one ready PR.

## Risks and verification limits

Native tools may truncate, normalize or split prompt text; only exact authenticated envelopes can become structured chat attribution. The receiving terminal still displays the original delivered envelope. Existing wrappers require explicit setup refresh. Stock Herdr exposes no atomic conditional recipient identity guard: use pre/post identity proof and do not publish verified attribution if it changed. Signed provenance authenticates peer content, not permissions or a human instruction. No network origin is embedded; source locators require a connected Ovis client and available metadata.
