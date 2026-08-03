# Agent harness decision log

This log records the reconciled outcome of https://linear.app/texas/issue/TEX-30/research-spike-agent-architecture-and-design. **Adopted** decisions are required by the v1 research design; **Provisional** choices need implementation evidence; **Deferred** work belongs to another issue.

## Decisions

| Status | Decision | Rationale / gate |
| --- | --- | --- |
| **Adopted** | Use a separate, non-interactive Bun CLI/harness; do not integrate into `index.js`. | Batch lifecycle, private transient input, cancellation, reports, and approvals differ from the interactive chat loop. |
| **Adopted** | Use deterministic planning with units `{ordinal, query, platform}`. | Stable order supports bounded retries, privacy-safe completed ordinals, reproducible approvals, and resume without replay. No LLM planner is required. |
| **Provisional** | Bun owns orchestration and a narrow Python 3.10+ subprocess bridge owns SocialScan. | This matches the actual repository while retaining isolation. Release requires benchmark and fixture evidence. Python 3.10+ is our baseline, not an upstream guarantee. |
| **Adopted** | Pin the sole SocialScan candidate to `socialscan==2.0.1`, commit/tag `7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8`, wheel SHA-256 `be3075208c6e1dc577869ed27ca37fb1ad14d95e37641fc85d5c09f307e93be3`. | The bridge contract is now exact: import `Platforms, execute_queries` from `socialscan.util`; call `await execute_queries([query], [platform])`; never nest the `sync_execute_queries`/`asyncio.run` wrapper. Live use stays blocked pending hermetic Python 3.10+ fixtures and a separately approved limited probe. |
| **Adopted** | Allow exactly the pinned eight-member platform manifest: `github`, `gitlab`, `instagram`, `pinterest`, `reddit`, `twitter`, `tumblr`, `firefox`. | The v2.0.1 code enum is authoritative. Unsupported query/platform combinations may be omitted and classify as `unknown`. Expansion requires a new manifest/review. |
| **Adopted** | Preserve five outcomes: `available`, `taken`, `invalid`, `unknown`, `error`. | Pinned `PlatformResponse` fields distinguish valid unavailability from invalid input. `unknown` is reserved for omitted/inconclusive results. Raw query/message/link never cross the bridge. |
| **Adopted** | Retry one provider check and never replay a success. | Provider-lane pacing, pause, retry-after, and circuits contain amplification. Total attempts are bounded by `plannedUnits * (1 + retriesPerUnit)` plus preset/manifest/deadline ceilings. |
| **Adopted** | Use canonical `executionMode` and plan-bound approvals. | `--approve-live` authorizes rather than overrides. Actual input counts are validated before approval; signed approvals bind plan/version/count/platforms/preset/attempts/expiry/operator; Fast needs separate acknowledgment. Conflicts/stale approvals fail before dispatch. |
| **Adopted** | Support privacy-safe v1 resume. | Opaque run IDs, exclusive locks, deterministic ordinals, aggregate-only checkpoints, and keyed HMAC permit skip-without-replay while keeping input outside persisted state. Resume requires fresh approval and rejects missing keys, changed plans, stale state, or concurrency. |
| **Adopted** | Use aggregate-only, bounded observability. | Reports include bounded `byPlatform` aggregates and phase timings, capped at 256 KiB. Maps use stable manifests/enums; no PII, provider output, proxy/auth data, credentials, or raw exceptions are admitted. |
| **Adopted** | Strip ambient proxy/auth/network credentials from bridge processes. | The adapter uses an absolute Python path and minimal environment allowlist. Approved provider-scoped secrets use a dedicated secret-safe channel, never inherited environment, arguments, logs, reports, or checkpoints. |
| **Adopted** | Enforce absolute monotonic deadlines, secure local paths, atomic state/report writes, and stable report failure behavior. | Cancellation covers all phases and process groups, with a 1-second graceful termination and 2-second cleanup/report reserve. Unsafe paths and TOCTOU replacement fail closed; required report failure returns `REPORT_WRITE_FAILED`. |
| **Provisional** | Treat https://github.com/Smidjehoien/void-language/pull/6 only as unapproved prototype evidence. | It demonstrates broad shape but is open, non-green, and not authoritative where its interfaces differ from these docs. |
| **Deferred** | HTTP dashboard/status polling. | Owned by https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required; not approved or implemented by https://linear.app/texas/issue/TEX-30/research-spike-agent-architecture-and-design. |
| **Deferred** | Optional Web3 hash anchoring. | Owned by https://linear.app/texas/issue/TEX-35/web3-anchoring-hash-only-evm-attestation-optional; only after sanitized report construction and disabled by default. |

## Repository/runtime deviation

The kickoff referenced `Smidjehoien/iotosint`, `socialscan/agents/`, and a primarily Python repository. The assigned repository is `Smidjehoien/void-language`, a Bun/JavaScript application without SocialScan on `main`. The adopted design follows the actual target: Bun orchestration with a pinned Python bridge. Moving implementation elsewhere requires an explicit repository/scope decision.

## Dependencies and blockers

- https://linear.app/texas/issue/TEX-31/prototype-agent-harness-orchestrator-and-async-queries must implement the exact one-unit adapter, secure process boundary, resume, and report contracts.
- https://linear.app/texas/issue/TEX-32/safety-and-ethics-safeguards must enforce presets, approvals, path/process isolation, privacy, and tests.
- Live execution is blocked until hermetic SocialScan fixtures pass across supported Python 3.10+ releases and a separately approved limited compatibility probe succeeds.
- Stakeholder/allowlist authorization in https://linear.app/texas/issue/TEX-11/create-sentient-androids must be rechecked before implementation milestones and every live probe.
- Performance remains provisional until benchmarked; safety ceilings may not be raised solely to meet the 4–6 second target.

## Remaining open implementation choices

- Benchmark one-process-per-check versus a bounded persistent bridge while preserving one-unit semantics, environment isolation, process-group cancellation, and no secret/value persistence.
- Select the installation-local HMAC key backend per supported operating system and define approved checkpoint retention/rotation defaults.
- Set provider-specific pacing ceilings after policy review and fixture/live-probe evidence; they may only lower the preset ceilings.

SocialScan selection and resumability are no longer unresolved design items: they are explicit adopted decisions with release gates above.
