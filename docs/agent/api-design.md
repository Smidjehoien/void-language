# Agent harness API design

**Status:** Adopted v1 research contract. Live implementation remains gated by the compatibility and approval requirements below.

## CLI surface and execution semantics

Manifest-driven live run:

```text
bun run agent:run -- \
  --request ./run-request.v1.json \
  --input ./private-queries.txt \
  --output ./run-report.v1.json \
  --checkpoint ./run-checkpoint.v1.json \
  --approve-live
```

`executionMode` in the request is canonical. CLI mode flags may be used only when the CLI synthesizes the whole request; they must not conflict with a supplied request manifest. `--approve-live` is ephemeral authorization for `executionMode: "live"`, not a mode override, and is rejected for `executionMode: "dry-run"`. Fast additionally requires `--acknowledge-fast` or the equivalent separately signed acknowledgment. Unknown and conflicting flags fail with `INVALID_REQUEST` before dispatch.

Before presenting or validating approval, the loader securely opens and validates the local input and computes the **actual** query count, planned units, and maximum attempts. It must not dispatch, log, display, or persist query values while doing so. A declared count is only an optional upper-bound assertion and must match the actual count if supplied.

`executionMode: "dry-run"` is strictly local: secure input validation and deterministic planning only. It must not perform network-capable/provider preflight, spawn the Python bridge, call `adapter.preflight` or `adapter.check`, access a proxy/auth secret channel, dispatch work, or create/update an execution-progress checkpoint. It returns a bounded sanitized report with `status: "planned"` and counts/limits only. Compatibility probes are separate explicit operations, never an implicit dry-run phase.

## Versioned run request

```json
{
  "schemaVersion": 1,
  "goal": "public-account-availability",
  "executionMode": "dry-run",
  "platforms": ["github", "gitlab"],
  "preset": "safe",
  "input": {
    "kind": "newline-file",
    "declaredCount": 2
  }
}
```

V1 validation requires:

- exactly `schemaVersion: 1` and `goal: "public-account-availability"`;
- exactly one `executionMode`: `dry-run` or `live`;
- 1–1,000 non-empty input lines, each at most 320 UTF-8 bytes after normalization;
- 1–8 unique platform IDs from the pinned manifest: `github`, `gitlab`, `instagram`, `pinterest`, `reddit`, `twitter`, `tumblr`, `firefox`;
- one of `safe`, `balanced`, or `fast`; no custom setting may exceed the Fast ceiling;
- request document at most 64 KiB, bridge request at most 1 KiB, bridge response at most 16 KiB, and report at most 256 KiB;
- unknown fields rejected rather than ignored.

## Local path contract

Existing request, input, and resume-checkpoint paths must securely resolve to safe local regular files in operator-controlled directories. A prospective report destination must not exist. The harness rejects symlinks, devices, sockets, FIFOs, procfs/sysfs-style paths, non-local mounts when they cannot provide required atomicity, unsafe ownership, and group/world-writable files or parent directories. Opens use platform-appropriate no-follow/exclusive primitives and verify identity/metadata after opening to prevent TOCTOU replacement.

Input and request files are opened read-only. A new checkpoint uses restrictive exclusive creation; subsequent same-directory temporary updates may atomically replace it only while the exclusive run lock is held and only after verifying the existing file is the run-owned checkpoint. A new report is built in a restrictively created same-directory temporary and published with `renameat2(..., RENAME_NOREPLACE)` or an equivalent atomic same-filesystem no-clobber primitive. If the platform cannot guarantee atomic no-replace, publication fails closed; ordinary overwrite-capable rename is forbidden. A competing create immediately before publication returns `REPORT_DESTINATION_EXISTS` and never overwrites either file. Completed/stale checkpoints require explicit safe rotation to a new path or run ID. Reports are never overwritten. Resume refuses replacement, ownership, mode, or schema mismatches.

## Deterministic plan and harness contract

The internal plan is ordered input-major, then by normalized manifest platform order:

```text
PlannedUnit = { ordinal: integer, query: TransientString, platform: PlatformId }

runHarness({
  schemaVersion: 1,
  runId: OpaqueRunId,
  executionMode: "dry-run" | "live",
  units: PlannedUnit[],
  policy: ResolvedPreset,
  remainingActiveBudgetMs: AuthenticatedDuration,
  signal: AbortSignal,
  adapter: AvailabilityAdapter
}) -> Promise<RunReportV1>
```

Reject platform IDs outside the pinned manifest before planning. Plan every valid requested `{query, platform}` unit in deterministic normalized-input order × pinned-manifest platform order; do not query-filter or silently compatibility-filter. `plannedUnits = actualQueryCount * platformCount` is authoritative for approval/HMAC binding, attempt ceilings, checkpoint ordinals, and report `requested` counts. If SocialScan omits a requested combination, the planned unit completes as `unknown` rather than disappearing. `maxAttempts = min(plannedUnits * (1 + retriesPerUnit), presetAttemptCeiling, manifestAttemptCeiling, activeBudgetFeasibleAttempts)`. The harness rejects a request whose resolved counts exceed any ceiling.

The opaque run ID is random and contains no input-derived material. One exclusive run/checkpoint lock prevents concurrent duplicate execution. Successful completed ordinals are immutable: retries and resume may schedule only incomplete ordinals.

## Adapter and bridge contract

```text
adapter.preflight({ platformManifestVersion, pythonPath, signal })
  -> { ready: true, adapterVersion, pythonVersion, socialscanVersion, wheelSha256 }

adapter.check({ ordinal, transientQuery, platform, timeoutMs, signal, secretChannel })
  -> TransientProviderOutcome
```

`adapter.check` accepts exactly one platform. A transient outcome may include the platform ID, retry-after hint, and lane state needed by the scheduler, but no transient outcome is persisted per query/provider.

The adapter launches an already-resolved absolute Python executable with an explicit minimal environment allowlist. It strips ambient `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, lowercase variants, provider tokens, cloud credentials, auth variables, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and similar network/certificate overrides. Approved proxy/auth configuration must be provider-scoped and delivered through a dedicated inherited descriptor or equivalent secret-safe channel. It is never inherited implicitly, placed in process arguments, logged, or written to reports/checkpoints.

Bridge request, sent only on stdin and never logged:

```json
{
  "bridgeVersion": 1,
  "action": "check",
  "ordinal": 3,
  "query": "<transient-input>",
  "platform": "github"
}
```

The Python 3.10+ bridge imports:

```text
from socialscan.util import Platforms, execute_queries
```

It calls `await execute_queries([query], [platform])` exactly once for the unit. It must not call `sync_execute_queries`, because v2.0.1 implements that wrapper with `asyncio.run`, which cannot be nested in the bridge's running event loop.

The sole candidate is `socialscan==2.0.1`, commit/tag `7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8`, PyPI wheel SHA-256 `be3075208c6e1dc577869ed27ca37fb1ad14d95e37641fc85d5c09f307e93be3`. Canonical references:

- https://pypi.org/project/socialscan/2.0.1/
- https://github.com/iojw/socialscan/blob/7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8/socialscan/util.py
- https://github.com/iojw/socialscan/blob/7373757e616cbe5a56e1a67b9a39e3ae67bcb2a8/socialscan/platforms.py

The bridge validates only the pinned `PlatformResponse` fields: `platform`, `query`, `available`, `valid`, `success`, `message`, and `link`. It verifies that returned platform/query correspond to the transient request, then discards raw `query`, `message`, and `link`; none may cross stdout. The v2.0.1 result list may omit unsupported query/platform combinations.

Bounded response:

```json
{
  "bridgeVersion": 1,
  "ordinal": 3,
  "ok": true,
  "classification": "taken",
  "failureCode": null,
  "retryAfterMs": null
}
```

Classification rules:

- `available`: `success && valid && available`.
- `taken`: `success && valid && !available`.
- `invalid`: `success && !valid`; it remains distinct from `unknown`.
- `unknown`: no result was returned for the unit or the bounded pinned fields are inconclusive.
- `error`: the bridge/provider operation failed with a stable failure code.

No classification may be inferred from raw message or link text. `unknown` and `error` are never coerced to `available` or `taken`.

## Retry, provider lanes, and deadlines

Only one failed unit is retried; successful provider checks are never replayed. Retryable transient outcomes may carry provider identity internally for bounded `Retry-After`, capped exponential backoff with jitter, provider-lane pacing/pause, and run-scoped circuit behavior. If provider isolation is unavailable, a throttle or circuit pauses the entire logical lane for that provider, not unrelated providers and not already successful ordinals.

The checkpoint preserves one total active processing budget across invocations as authenticated `remainingActiveBudgetMs`, not an absolute monotonic timestamp. Each invocation derives its local absolute deadline as `monotonic_now + remainingActiveBudgetMs`, charges monotonic elapsed time while the harness is active, and persists a non-increasing remaining duration before/after attempts and on orderly cancellation. Dormant time between invocations is not charged because provider work cannot occur. A new attempt is forbidden unless the remaining budget covers its reserved attempt timeout plus the 2-second cleanup/report reserve. On cancellation or timeout, terminate the process group, allow 1 second for graceful exit, then force-kill it.

Immediately before dispatch, persist a checkpoint that conservatively debits the full reserved attempt budget. Subsequent checkpoints may reduce the remaining duration further; they may reconcile a reservation only when authenticated crash-safe state proves dispatch did not occur, and may never increase beyond any previously safe value. Missing, unauthenticated, inconsistent, incompatible-schema, zero, or expired budget state fails closed. Resume caps the authenticated duration by the original preset ceiling and any newly approved lower limit, never increases it, and still requires fresh live/Fast approval.

## Approval contract

Interactive approval displays only sanitized plan facts: actual query count, platforms, preset, planned units, retries per unit, `maxAttempts`, active processing budget, and retention behavior. It never displays input values.

A non-interactive signed approval is accepted only if its authenticated payload binds all of:

- request/plan digest and manifest schema/version;
- actual query count, normalized platform list, and authoritative `plannedUnits`;
- preset, computed `maxAttempts`, and approved active processing budget;
- execution mode, expiry, and operator identity.

Fast requires a separate explicit acknowledgment bound to the same plan. Missing, expired, stale, differently scoped, or signature-invalid approval returns `LIVE_APPROVAL_REQUIRED` or `APPROVAL_STALE`; a mode/flag/manifest conflict returns `INVALID_REQUEST`; missing Fast acknowledgment returns `FAST_ACK_REQUIRED`. All are terminal before provider dispatch. Resume always requires fresh live/Fast approval.

The request/plan digest used for approval may be a strong digest over canonical transient planning material because the approval is not persisted as an input fingerprint. Checkpoint identity uses the keyed HMAC contract below and never persists an unhashed/unsalted low-entropy digest.

## Checkpoint and resume contract

The checkpoint contains only:

```json
{
  "schemaVersion": 1,
  "runId": "opaque-run-id",
  "state": "in_progress",
  "preset": "safe",
  "compatibility": {
    "manifestVersion": "socialscan-2.0.1-v1",
    "pythonBaseline": ">=3.10"
  },
  "limits": {
    "plannedUnits": 4,
    "maxAttempts": 8,
    "originalActiveBudgetCeilingMs": 900000,
    "remainingActiveBudgetMs": 780000
  },
  "aggregate": {
    "attempts": 3,
    "retries": 0,
    "completedUnits": 3
  },
  "completedOrdinals": [0, 1, 2],
  "inputPlanHmac": "keyed-hmac"
}
```

No query, email/handle, provider URL, message, or per-query/provider outcome is checkpointed. `inputPlanHmac` covers the exact normalized input, resolved deterministic plan, schema/manifest versions, preset, attempt ceilings, original active-budget ceiling, and non-increasing remaining active budget using an installation-local key held outside the checkpoint/report, such as an OS credential store. Never persist a bare or unsalted digest of low-entropy input.

`--resume` securely rereads the operator input, reacquires the exclusive lock, recomputes the HMAC and plan, and skips completed ordinals. It authenticates the original active-budget ceiling and non-increasing remaining duration, then caps the latter by the original preset ceiling and any newly approved lower limit. Reject missing keys, HMAC/plan/input changes, missing/unauthenticated/inconsistent/zero/expired budget data, stale or completed state, concurrent runs, unsafe path replacement, and schema/compatibility mismatch before dispatch.

Checkpoint updates are atomic and may replace only the identity/ownership-verified run-owned checkpoint while its exclusive lock is held. Persist before each attempt with its reserved budget already debited, after attempts, and on orderly cancellation. Only fully completed ordinals are added; active attempts are terminated, and the last valid checkpoint remains resumable without resetting the budget. A new invocation without `--resume` cannot reuse an active run ID/checkpoint. Completed runs are immutable and require explicit safe rotation/new run ID.

## Stable failure codes

All report maps are bounded to this versioned enum:

| Category | Stable codes | Retryable |
| --- | --- | --- |
| Validation/path | `INVALID_REQUEST`, `INVALID_INPUT`, `UNSAFE_PATH`, `PLATFORM_UNSUPPORTED` | No |
| Approval/policy | `LIVE_APPROVAL_REQUIRED`, `APPROVAL_STALE`, `FAST_ACK_REQUIRED`, `POLICY_LIMIT_EXCEEDED` | No |
| Compatibility | `PYTHON_VERSION_UNSUPPORTED`, `SOCIALSCAN_VERSION_UNSUPPORTED`, `PROVIDER_API_UNVERIFIED` | No |
| Lock/resume | `RUN_LOCKED`, `CHECKPOINT_INVALID`, `RESUME_INPUT_CHANGED`, `RESUME_STATE_STALE` | No |
| Bridge/provider | `BRIDGE_CONFIGURATION`, `BRIDGE_IMPORT_FAILURE`, `BRIDGE_OUTPUT_INVALID`, `BRIDGE_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RESPONSE_UNKNOWN` | Only documented transient timeout/rate/unavailable classes, within budget |
| Lifecycle/report | `RUN_CANCELED`, `RUN_DEADLINE_EXCEEDED`, `REPORT_DESTINATION_EXISTS`, `REPORT_WRITE_FAILED` | No automatic rerun |

Raw exceptions, stdout/stderr, provider messages/URLs, proxy details, headers, response bodies, and credentials are not report fields.

## Aggregate run report

```json
{
  "schemaVersion": 1,
  "run": {
    "runId": "opaque-run-id",
    "status": "completed_with_failures",
    "preset": "safe",
    "executionMode": "live",
    "startedAt": "2026-08-03T16:00:00Z",
    "durationMs": 4120
  },
  "compatibility": {
    "adapterVersion": "1",
    "pythonBaseline": ">=3.10",
    "socialscanVersion": "2.0.1",
    "manifestVersion": "socialscan-2.0.1-v1"
  },
  "aggregate": {
    "queries": 2,
    "plannedUnits": 4,
    "completedUnits": 4,
    "available": 1,
    "taken": 1,
    "invalid": 1,
    "unknown": 0,
    "error": 1,
    "attempts": 5,
    "retries": 1,
    "failuresByCode": {
      "BRIDGE_TIMEOUT": 1
    },
    "byPlatform": {
      "github": {
        "requested": 2,
        "available": 1,
        "taken": 0,
        "invalid": 0,
        "unknown": 0,
        "error": 1,
        "retries": 1,
        "durationMs": 2200,
        "failuresByCode": {
          "BRIDGE_TIMEOUT": 1
        }
      },
      "gitlab": {
        "requested": 2,
        "available": 0,
        "taken": 1,
        "invalid": 1,
        "unknown": 0,
        "error": 0,
        "retries": 0,
        "durationMs": 1700,
        "failuresByCode": {}
      }
    }
  },
  "timingsMs": {
    "validation": 40,
    "preflightApproval": 300,
    "dispatch": 3700,
    "reportWrite": 80
  }
}
```

Allowed statuses are `planned`, `completed`, `completed_with_failures`, `canceled`, and `failed`. A dry-run report is `planned` and contains counts/limits only: no compatibility block, provider outcomes, dispatch timings, or execution-progress checkpoint. `byPlatform` keys are limited to the requested members of the eight-entry pinned manifest, each `requested` count comes from the authoritative plan, and every `failuresByCode` map is limited to the stable enum. Report serialization is capped at 256 KiB. Construction plus no-clobber atomic publication receives a 2-second reserved budget; temporary files are removed on failure. If the final destination exists, return `REPORT_DESTINATION_EXISTS`; if any other required report publication step fails, return `REPORT_WRITE_FAILED`. Retain only the last valid checkpoint when applicable and print no raw diagnostics.

Reports contain no query, email/handle, provider URL, message, account/profile data, proxy data, credentials, secret references, raw exception, or subprocess output.

## Release compatibility gate

Live execution remains disabled until hermetic normalization/omission fixtures pass across the project's supported Python 3.10+ release matrix and a separately approved limited live compatibility probe succeeds. Python 3.10+ is our baseline, not a claim that upstream officially tests those versions.

## Reserved HTTP contract

HTTP transport, polling, authentication, and remote idempotency are deferred to https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required. Optional Web3 anchoring remains deferred to https://linear.app/texas/issue/TEX-35/web3-anchoring-hash-only-evm-attestation-optional.
