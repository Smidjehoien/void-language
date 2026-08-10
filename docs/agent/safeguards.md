# Agent harness safeguards

**Status:** Adopted policy baseline for https://linear.app/texas/issue/TEX-30/research-spike-agent-architecture-and-design; implementation remains gated by https://linear.app/texas/issue/TEX-32/safety-and-ethics-safeguards and the stakeholder/allowlist policy in https://linear.app/texas/issue/TEX-11/create-sentient-androids.

The harness is limited to read-only public availability checks. It must not circumvent CAPTCHAs, access controls, authentication, robots restrictions, rate limits, or platform Terms of Service. It must not collect non-public personal data or persist raw personally identifying inputs.

## Bounded presets

All values are ceilings, not throughput promises. Provider policy can lower them.

| Preset | Concurrency | Retries per unit | Bridge timeout | Active processing budget | Absolute attempt ceiling | Approval |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Safe | 2 | 1 | 30 s | 15 min | 4,000 | Explicit live approval |
| Balanced | 4 | 2 | 30 s | 10 min | 6,000 | Explicit live approval |
| Fast | 8 | 2 | 20 s | 10 min | 6,000 | Live approval plus separate Fast acknowledgment |

One unit is `{ordinal, query, platform}`. Reject platform IDs outside the pinned manifest, then plan every valid requested unit in normalized-input order × pinned-manifest platform order without query or compatibility filtering. `plannedUnits = actualQueryCount * platformCount` binds approval/HMAC state, attempt ceilings, checkpoint ordinals, and report `requested` counts. A SocialScan omission completes that planned unit as `unknown`. `maxAttempts` is the minimum of `plannedUnits * (1 + retriesPerUnit)`, the table ceiling, the provider-manifest ceiling, and active-budget-feasible attempts. Successful units are never retried or replayed on resume.

Retries use bounded `Retry-After`, capped exponential backoff with jitter, and provider-lane pacing/pause/circuits. If provider isolation is unavailable, a throttle pauses all not-yet-started work in that provider's lane; it does not replay successes or pause unrelated providers. Fast does not unlock extra retries, proxy rotation, bypasses, hidden platforms, or automatic approval.

## Execution mode and approval

- `executionMode` in the request is authoritative. It is exactly `dry-run` or `live`.
- CLI mode flags may synthesize a request but cannot contradict a manifest. `--approve-live` authorizes live execution and is rejected for a dry run; it cannot override the mode.
- The harness securely reads and validates the local input before approval so the prompt/signature uses actual query count, platform count, planned units, and `maxAttempts`. Values are not dispatched, logged, displayed, or persisted.
- Dry-run performs only secure local validation and deterministic planning. It must not spawn the Python bridge, perform network-capable/provider preflight, call either adapter operation, access proxy/auth secret channels, dispatch work, or create/update an execution-progress checkpoint. It emits only a bounded sanitized `planned` report with counts/limits. Compatibility probes are separate explicit operations.
- Every live run requires deliberate approval bound to the resolved plan. Fast requires a second, explicit acknowledgment bound to that same plan.
- A signed non-interactive approval binds request/plan digest, manifest schema/version, actual count, platforms, authoritative `plannedUnits`, preset, `maxAttempts`, active processing budget, execution mode, expiry, and operator identity.
- Conflicting flags/manifests fail `INVALID_REQUEST`; missing or expired live approval fails `LIVE_APPROVAL_REQUIRED`/`APPROVAL_STALE`; missing Fast acknowledgment fails `FAST_ACK_REQUIRED`. Rejection occurs before provider dispatch.
- Resume requires fresh live and Fast approvals. Approval is never inherited from the original attempt.

## Pinned integration gate

The only v1 integration candidate is `socialscan==2.0.1`, commit/tag `7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8`, wheel SHA-256 `be3075208c6e1dc577869ed27ca37fb1ad14d95e37641fc85d5c09f307e93be3`. Its eight allowlisted platform IDs are `github`, `gitlab`, `instagram`, `pinterest`, `reddit`, `twitter`, `tumblr`, and `firefox`.

The bridge calls `await execute_queries([query], [platform])` for one unit and never calls `sync_execute_queries` from its active event loop. It classifies only pinned fields and never emits raw `query`, `message`, or `link`. `invalid` is distinct; omitted or inconclusive results are `unknown`.

Live execution is blocked until hermetic fixtures pass across supported Python 3.10+ versions and a separately approved limited live compatibility probe succeeds. Python 3.10+ is our release baseline, not an upstream testing guarantee. Automated live-provider CI/tests remain prohibited.

## Data minimization, checkpointing, and resume

- Raw input exists only in the operator-controlled input file and transient memory. Clear transient values as soon as practical after their unit completes.
- Use an opaque random run ID, exclusive run/checkpoint lock, and deterministic plan order.
- A checkpoint may contain schema/version metadata, preset/compatibility data, aggregate counters, attempt ceilings, the original active-budget ceiling, authenticated non-increasing `remainingActiveBudgetMs`, and completed ordinals only. It must never contain queries or per-query/provider outcomes.
- Bind checkpoint state to the exact input and plan with keyed HMAC using an installation-local key held outside reports/checkpoints, such as an OS credential store. Never persist a bare/unsalted low-entropy input digest.
- Resume securely rereads input, verifies HMAC and plan, skips completed ordinals, and preserves original ceilings plus the authenticated remaining active budget, capped by the original preset ceiling and any newly approved lower limit. Missing keys, changed input/plan, missing/unauthenticated/inconsistent/zero/expired budget, stale/completed state, schema mismatch, unsafe replacement, or concurrent duplicate execution fail closed.
- Checkpoint immediately before each attempt with the full reserved attempt budget already debited, then checkpoint after attempts and on orderly cancellation. The persisted duration never increases; reconciliation is allowed only when authenticated crash-safe state proves dispatch did not occur. Cancellation records only fully completed ordinals. Duplicate non-resume invocation cannot reuse an active run ID; completed runs are immutable and require safe rotation/new run ID.

## Path and process isolation

- Existing request, input, and resume-checkpoint paths must be safe local regular files in operator-controlled directories with safe ownership and restrictive modes; a prospective report destination must not exist.
- Reject symlinks, devices, sockets, FIFOs, procfs/sysfs/special files, unsafe parent directories, and path replacement. Use no-follow secure opens and post-open identity verification. Publish a restrictive same-directory report temporary only with `renameat2(..., RENAME_NOREPLACE)` or an equivalent atomic same-filesystem no-clobber primitive; fail closed if unavailable and never use ordinary overwrite-capable rename.
- A new checkpoint uses restrictive exclusive creation. A competing create immediately before report publication returns `REPORT_DESTINATION_EXISTS` and never overwrites. Update an active checkpoint only with a same-directory temporary while holding its exclusive lock and after verifying it is the run-owned checkpoint; completed/stale state requires explicit safe rotation. Reports are never replaced.
- Resolve the Python executable to an approved absolute path before spawn.
- Spawn with a minimal explicit environment allowlist. Strip all ambient proxy/auth/cloud/provider/certificate override variables, including upper/lowercase proxy variables and common CA bundle overrides.
- Approved proxy/auth configuration must be explicit and provider-scoped, passed through a dedicated secret-safe channel. It is never inherited, logged, included in arguments, reports, or checkpoints, and cannot be used for control circumvention or automatic rotation.

## Observability and report bounds

Reports and structured logs are aggregate-only. A live report includes total aggregates, `byPlatform` requested/outcome/retry/duration/failure-code aggregates, and phase `timingsMs` for validation, preflight/approval, dispatch, and report write. A dry-run report is `planned` with counts/limits only. Platform maps are bounded to requested members of the eight-entry manifest; failure maps are bounded to the versioned stable failure-code enum.

No query, email/handle, provider URL, provider message, profile/account data, proxy data, credentials, secret reference, raw exception, response body, header, stdout, or stderr may appear. Redaction is allowlist serialization: prohibited fields are never admitted, not merely masked.

The serialized report limit is 256 KiB. The harness reserves 2 seconds for bounded construction, atomic no-clobber publication, and cleanup. Existing reports are not overwritten; failed temporary files are removed. A destination race returns `REPORT_DESTINATION_EXISTS`; other required publication failures return `REPORT_WRITE_FAILED`, with no raw diagnostics. Default aggregate report retention is 30 days; shorter or immediate deletion is allowed, while longer retention requires approved purpose.

## Deadlines and cancellation

One total active processing budget covers secure validation, live compatibility preflight, approval wait, pacing/backoff, dispatch, bridge process groups, checkpointing, report construction, and atomic write across invocations. Each invocation derives an absolute deadline from `monotonic_now + authenticated remainingActiveBudgetMs` and decrements it using monotonic elapsed active time. Dormant time between invocations does not count because no provider work occurs. No attempt starts without enough time for its reserved timeout plus the 2-second cleanup/report reserve.

Cancellation aborts waits and sleeps, stops dispatch, terminates each bridge process group, waits 1 second, then force-kills it. Fully completed ordinals are atomically checkpointed. If the reserve remains, write a partial aggregate report marked `canceled`; if safe report emission fails, return `REPORT_WRITE_FAILED` and retain the last valid checkpoint. Never represent incomplete work as `available`, `taken`, or `invalid`; it remains uncompleted/unknown according to the aggregate contract.

## Prohibited behavior

- CAPTCHA, access-control, authentication, robots, rate-limit, or ToS circumvention.
- Collection or inference of non-public personal data.
- Persistence or logging of raw handles, emails, provider output, URLs, messages, proxy/auth data, credentials, per-query results, or raw exceptions.
- Ambient proxy/auth inheritance or secrets in subprocess arguments.
- Automated live-provider tests, scheduled live probes, or unattended compatibility checks.
- Treating `invalid`, `unknown`, or `error` as evidence of availability/taken status.
- Replaying successful checks during retry, resume, cancellation recovery, or duplicate invocation.
- Mode overrides, stale approvals, or implicit Fast approval.

## Test strategy

Dry-run and hermetic fixtures cover schemas, path attacks, input count mismatch, authoritative planning order/counts, one-platform adapter calls, all five outcome classes, unsupported-combination `unknown`, retry isolation, retry-after, lane circuits, attempt ceilings, approval conflicts/expiry, environment stripping, HMAC resume budget accounting, duplicate locks, cancellation/process-group cleanup, aggregate bounds, report overflow/write failure, and privacy serialization. Dry-run verification must assert zero subprocess spawn, adapter invocation, secret-channel access, provider/network activity, dispatch, and execution-progress checkpoint writes. Report publication tests must create the final destination immediately before publication and assert stable `REPORT_DESTINATION_EXISTS` with neither file overwritten. Crash/resume tests must prove pre-attempt reservation prevents restoration of the full active budget. Fixtures use synthetic placeholders only; no live traffic or copied provider payload is checked in.
