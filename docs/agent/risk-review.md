# Agent harness risk and release review

**Status:** Reconciled risk review for https://linear.app/texas/issue/TEX-30/research-spike-agent-architecture-and-design. Performance and live-provider compatibility remain unproven; the safety and contract requirements below are release-blocking.

| Risk | Impact | Mitigation / release gate |
| --- | --- | --- |
| Performance target is unverified | The https://linear.app/texas/issue/TEX-11/create-sentient-androids target of 100 queries in approximately 4–6 seconds may not hold through isolated subprocesses or current providers. | Benchmark declared hardware against the pinned direct baseline, publish median/p95 with query/platform/attempt counts, and require approved regression or target change. Never weaken safety ceilings to hit the target. |
| SocialScan API/runtime drift | Changed imports, enum members, result fields, or omission behavior can cause false classifications. | Sole candidate: `socialscan==2.0.1`, commit/tag `7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8`, wheel SHA-256 `be3075208c6e1dc577869ed27ca37fb1ad14d95e37641fc85d5c09f307e93be3`. Hermetic fixtures must pass across supported Python 3.10+; a separate approved limited live probe must pass. Python baseline is ours, not an upstream guarantee. |
| Unsupported query/platform omission | The pinned function can omit combinations, which could be mistaken for invalid/available. | Call `await execute_queries([query], [platform])` for one unit; classify no result as `unknown`. Keep `invalid` distinct and derive no result from message/link text. |
| Retry amplification | Multi-platform retries or duplicate resume could replay successful public checks and increase load. | Unit is `{ordinal, query, platform}`; persist completed ordinals; retry/resume only incomplete units. Bound `maxAttempts` by formula, preset, manifest, and deadline; use provider-lane pacing/pause/retry-after/circuits. |
| Lane isolation unavailable | A shared adapter/provider state may make a local throttle broader than one worker. | Conservatively pause the entire logical provider lane and admit no new checks for it. Do not pause unrelated providers or replay successes. |
| Approval ambiguity | Flags could silently turn a dry run live or signed approvals could be reused for a changed plan. | Canonical `executionMode`; reject conflicts and `--approve-live` on dry-run. Validate actual input before approval. Bind signed approval to digest/version/count/platforms/preset/max attempts/expiry/operator; require separate Fast acknowledgment and fresh resume approval. |
| Resume leaks or replays data | A checkpoint could expose low-entropy handles or replay completed work after crash. | Opaque run ID, exclusive lock, deterministic ordinals, aggregate-only checkpoint, installation-keyed HMAC over exact input/plan, atomic writes, and skip completed ordinals. Reject missing keys, changes, stale/schema mismatch, and concurrent duplicates. |
| Report/log leakage | Inputs, provider URL/message, payloads, proxies, credentials, or exceptions could escape. | Allowlist serialization only. Aggregate totals, bounded `byPlatform`, stable failure codes, and phase timings. Privacy tests and manual diff review are release gates. |
| Ambient proxy/auth exfiltration | Child libraries may inherit workstation proxies, tokens, cloud credentials, or certificate overrides. | Resolve an absolute Python path, spawn with a minimal environment allowlist, strip proxy/auth/certificate variables, and permit provider-scoped secrets only through a dedicated non-argument secret-safe channel after approval. |
| Unbounded/failed report | Large maps or slow storage can exhaust memory/deadline or leave corrupt output. | Stable platform/failure enums, 256 KiB serialized maximum, bounded construction, 2-second cleanup/write reserve, restrictive same-directory atomic write, temporary cleanup, and terminal `REPORT_WRITE_FAILED` without raw diagnostics. |
| Cancellation leaves work running | Bridge children or waits may outlive the operator request and produce inconsistent partial state. | One absolute monotonic deadline covers all phases. Stop new work when attempt+reserve cannot fit; cancel waits/backoff; terminate process groups, wait 1 second, force-kill; checkpoint completed ordinals and atomically write a partial `canceled` report when possible. |
| Path traversal/TOCTOU | Symlinks, devices, unsafe directories, or replacement can redirect private input or reports. | Require local regular files in operator-controlled directories, safe ownership/modes, non-following opens, post-open identity checks, exclusive create, and atomic rename. Never overwrite reports; checkpoint update requires lock/resume rules. |
| Provider/ToS changes | Checks may become prohibited, throttled, or inaccurate. | Eight-entry pinned manifest with policy notes and lowerable per-provider ceilings. Disable unclear providers; never bypass controls. Review before release/probe. |
| Scope creep | LLM planning, writes, private access, HTTP exposure, or Web3 could appear without review. | Deterministic read-only v1 schema. New goals require schema/threat/stakeholder review. HTTP remains with https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required; Web3 remains with https://linear.app/texas/issue/TEX-35/web3-anchoring-hash-only-evm-attestation-optional. |
| Prototype mistaken for approval | PR #6 may be treated as releasable architecture. | https://github.com/Smidjehoien/void-language/pull/6 is unapproved prototype evidence only; reconcile any implementation with these docs and independently disposition its checks. |

## Release checklist

- [ ] Stakeholder approval, allowlist, and target repository reconfirmed in https://linear.app/texas/issue/TEX-11/create-sentient-androids.
- [ ] Python 3.10+ project baseline enforced without claiming upstream test support.
- [ ] `socialscan==2.0.1`, commit/tag, wheel hash, eight-platform manifest, import path, one-unit async call, and pinned fields verified.
- [ ] Hermetic fixtures cover all outcomes, omitted combinations, malformed results, and supported Python 3.10+ runtimes; separate limited live probe approved and passed.
- [ ] Deterministic `{ordinal, query, platform}` planning, no-success-replay retries, provider lanes, retry-after, circuits, formula, and ceilings enforced.
- [ ] Canonical mode, actual-count preapproval validation, signed approval binding, stale/conflict rejection, and separate Fast acknowledgment enforced.
- [ ] Opaque run ID, exclusive locks, keyed-HMAC checkpoints, atomic resume, skip-completed behavior, and duplicate/cancellation cases verified.
- [ ] Aggregate report contains bounded `byPlatform` and phase `timingsMs`; privacy tests prove prohibited fields cannot serialize.
- [ ] Minimal child environment and explicit provider-scoped secret channel verified; ambient proxy/auth/certificate variables cannot pass.
- [ ] 256 KiB report bound, stable map cardinality, 2-second write reserve, cleanup, and `REPORT_WRITE_FAILED` behavior tested.
- [ ] Absolute monotonic deadline and cancellation cover every phase; process groups receive 1-second grace then force-kill; partial checkpoint/report semantics tested.
- [ ] Secure local path, no-follow/TOCTOU, ownership/mode, exclusive create, atomic rename, and no-overwrite tests pass.
- [ ] Benchmark reports median/p95 without changing safety ceilings.
- [ ] Required repository checks are green or infrastructure failures are explicitly dispositioned by maintainers.
- [ ] HTTP and Web3 remain deferred and disabled; PR #6 remains described only as unapproved evidence.

## Research-spike deliverable coverage

1. **Architecture:** `architecture.md` defines entry point, deterministic planner, adapter, memory/checkpointing, reporting, concurrency, retries, deadlines, safety gates, and deferrals.
2. **API design:** `api-design.md` defines request/output schemas, exact SocialScan integration, approval, resume, observability, and the https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required deferral.
3. **Safeguards:** `safeguards.md` defines presets, data handling, human checkpoints, process/path isolation, logging, and tests.
4. **Decision log:** `decision-log.md` records adopted/provisional/deferred choices, rationales, blockers, repository deviation, and remaining implementation choices.
5. **Risk review:** this document records performance, compatibility, privacy, retry, approval, resumability, cancellation, path, dependency, and scope risks with release gates.
