# Agent harness risk and release review

**Status:** Risks identified by TEX-30. None of the performance or compatibility claims below are considered proven.

| Risk | Impact | Mitigation / release gate |
| --- | --- | --- |
| Performance target is unverified | The TEX-11 target of 100 queries in approximately 4–6 seconds may not hold in this repository, against current providers, or through subprocesses. | Benchmark on declared commodity hardware against a pinned direct-SocialScan baseline. Publish median/p95 timings and query/platform counts. Release requires no more than the approved regression (TEX-11 proposes ±25%) or an approved target change. Never raise safety limits solely to hit the target. |
| SocialScan API drift | Imports, platform enums, async behavior, and result fields may change, causing false classifications. | Pin/document the supported API, validate preflight, maintain offline contract fixtures, and fail closed to `unknown`/compatibility errors. Release requires explicit compatibility evidence. |
| Provider/platform/ToS/rate-limit changes | Checks may become prohibited, throttled, inaccurate, or blocked. | Maintain a versioned provider allowlist with policy notes and per-provider ceilings. Disable a provider when terms or behavior are unclear; do not bypass controls. Review before each release. |
| Python subprocess overhead | Process startup and JSON serialization may dominate small checks or prevent the 4–6 second target. | Benchmark one-process-per-check versus a bounded persistent bridge without weakening isolation. Keep output bounded and preserve cancellation. Select only after measurement. |
| Report/log leakage | Raw handles, provider payloads, URLs, or exceptions could expose personal data. | Aggregate-only schemas, allowlist serialization, redaction-before-write, restrictive permissions, privacy tests, and manual diff review. Any raw-value persistence blocks release. |
| Proxy/auth mishandling | Credentials or proxy URLs could leak, or proxy use could become circumvention. | No proxy values in request/report/log schemas. Load approved secrets out of band, pass only to the adapter, and prohibit automatic rotation intended to evade controls. Security review required before enabling proxy/auth support. |
| Scope creep into autonomous behavior | An LLM planner, writes, private-data access, or follow-up actions could appear without review. | Deterministic planner and read-only goal enum in v1. New goals/capabilities require schema versioning, threat review, and stakeholder approval. |
| Top five versus all platforms | Supporting every advertised platform increases drift, policy, and test surface; limiting scope may miss expectations. | Start with a reviewed top-five compatibility manifest unless stakeholders explicitly approve all compatible platforms. Report unsupported platforms at validation, not at runtime. |
| Optional Web3 placement | Anchoring too early could leak data or make core runs depend on a chain/wallet. | Keep it after sanitized report construction, hash-only, per-run opt-in, and disabled by default under https://linear.app/texas/issue/TEX-35/web3-anchoring-hash-only-evm-attestation-optional. Core CLI must work without it. |
| Missing or changed stakeholder approval | Research assumptions could be treated as authorization for implementation or live use. | Re-check the approval/allowlist in https://linear.app/texas/issue/TEX-11/create-sentient-androids before implementation milestones and live-provider testing. Stop if approval is absent, revoked, or ambiguous. |
| PR #6 is open with non-green checks | Prototype behavior may be mistaken for approved/releasable implementation. Current CLA and pre-commit checks fail/error. | Treat https://github.com/Smidjehoien/void-language/pull/6 only as evidence. Do not merge or release based on it until checks are fixed or formally dispositioned and its interfaces are reconciled with these docs. |
| Failure/retry amplification | Retry storms can increase load during provider outages. | Retry only stable transient classes, cap attempts, add jitter, honor safe backoff, use provider circuits, and stop at run deadline. Test retry exhaustion offline. |
| Cancellation/report inconsistency | A canceled process could leave workers running or produce misleading totals. | Propagate one abort signal, terminate subprocesses, stop dispatch, atomically emit a partial report marked `canceled`, and reconcile requested/completed/outcome counts. |
| HTTP UI expands attack surface | Network exposure adds authentication, storage, CSRF, and status-leak risks. | Defer to https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required. Require local-only default, authentication, sanitized polling, retention controls, and a separate security review. |

## Release checklist

- [ ] Stakeholder approval and repository target reconfirmed in TEX-11.
- [ ] Python 3.10+ enforcement verified.
- [ ] SocialScan package/API and supported provider manifest pinned and documented.
- [ ] Four-way result classification validated with offline fixtures.
- [ ] Safe/Balanced/Fast ceilings, approval gates, cancellation, and retry budgets enforced.
- [ ] No automated live-provider tests; any manual compatibility run separately approved.
- [ ] Privacy tests prove no raw input, provider payload, proxy/auth data, or raw exceptions reach logs/reports.
- [ ] Benchmark compares direct baseline and bridge design with median/p95 results.
- [ ] All required repository checks are green or explicitly dispositioned by maintainers.
- [ ] HTTP and Web3 remain deferred and disabled unless their issues approve implementation.
