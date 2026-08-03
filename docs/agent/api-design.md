# Agent harness API design

**Status:** Provisional v1 contract. Names and limits are release candidates until the SocialScan compatibility gate is satisfied.

## CLI surface

```text
bun run agent:run -- \
  --request ./run-request.v1.json \
  --input ./private-queries.txt \
  --output ./run-report.v1.json \
  --approve-live
```

`--request`, `--input`, and `--output` are required. `--approve-live` records interactive/operator approval for public-provider calls; `--dry-run` validates and plans without calling providers. Direct overrides such as `--preset`, `--platform`, or `--timeout-ms` may be supported only if they pass the same schema and preset ceilings. The CLI must reject conflicting flags and unknown options.

The input file is newline-delimited and transient. It must be permission-restricted, read only after validation/approval, and never copied to the request document, report, console logs, test snapshots, or error messages.

## Versioned run request

```json
{
  "schemaVersion": 1,
  "goal": "public-account-availability",
  "platforms": ["github", "gitlab"],
  "preset": "safe",
  "input": {
    "kind": "newline-file",
    "count": 2
  },
  "dryRun": true
}
```

The request stores only input location/type metadata and a declared count, not the values. Recommended v1 validation limits:

- exactly `schemaVersion: 1` and `goal: "public-account-availability"`;
- 1–1,000 non-empty input lines, each at most 320 UTF-8 bytes after normalization;
- 1–11 unique platform identifiers from the pinned compatibility manifest;
- one of `safe`, `balanced`, or `fast`; no custom setting may exceed the Fast ceiling;
- request document at most 64 KiB and bridge response at most 1 MiB;
- local input/output paths only in v1; no URLs, inline credentials, or inline query arrays;
- unknown fields are rejected rather than ignored.

## Harness contract

The in-process harness receives validated transient values plus a policy object. This is an internal contract, not a persistence format.

```text
runHarness({
  schemaVersion: 1,
  queries: TransientString[],
  platforms: PlatformId[],
  policy: ResolvedPreset,
  signal: AbortSignal,
  adapter: AvailabilityAdapter
}) -> Promise<RunReportV1>
```

The orchestrator creates a deterministic plan, applies a bounded worker pool, passes cancellation to the adapter, and returns an aggregate report even when individual checks fail. Validation, compatibility, approval, or report-write failures are run-level failures.

## Adapter contract

```text
adapter.preflight({ platforms, compatibilityVersion, signal })
  -> { ready: true, adapterVersion, providerApiVersion }

adapter.check({ transientQuery, platforms, timeoutMs, signal })
  -> {
       counts: { available, taken, unknown, error },
       failuresByCode: Record<FailureCode, number>
     }
```

Result semantics are deliberately distinct:

- `available`: the provider returned a successful, valid response that explicitly indicates the identifier is not taken.
- `taken`: the provider returned a successful, valid response that explicitly indicates an existing account/identifier.
- `unknown`: no definitive availability result was possible, such as an unsupported/changed response, provider throttle, or ambiguous validity.
- `error`: the check could not complete because the harness, bridge, configuration, timeout, or provider operation failed.

`unknown` must never be coerced to `available`, and `error` must never be reported as `taken`. Per-query classifications are used transiently for aggregation and are not persisted in v1.

## Python bridge contract

The Bun adapter starts a Python 3.10+ subprocess with JSON on stdin and one bounded JSON object on stdout. The bridge must not write provider diagnostics to stdout.

Request (transient; never logged):

```json
{
  "bridgeVersion": 1,
  "action": "check",
  "query": "<transient-input>",
  "platforms": ["github", "gitlab"]
}
```

Response:

```json
{
  "bridgeVersion": 1,
  "ok": true,
  "counts": {
    "available": 1,
    "taken": 0,
    "unknown": 1,
    "error": 0
  },
  "failuresByCode": {
    "PROVIDER_RATE_LIMITED": 1
  }
}
```

The bridge validates exact fields and versions, imports only the pinned SocialScan interface, normalizes outputs, and discards raw provider payloads and exceptions. Bun kills the process on timeout, cancellation, oversized output, or malformed output.

## Stable failure classifications

The public report uses stable categories; implementation details may map to more specific internal codes.

| Category | Example stable codes | Retryable |
| --- | --- | --- |
| Validation | `INVALID_REQUEST`, `INVALID_INPUT`, `PLATFORM_UNSUPPORTED` | No |
| Approval/policy | `LIVE_APPROVAL_REQUIRED`, `POLICY_LIMIT_EXCEEDED` | No |
| Compatibility | `PYTHON_VERSION_UNSUPPORTED`, `SOCIALSCAN_VERSION_UNSUPPORTED`, `PROVIDER_API_UNVERIFIED` | No |
| Bridge | `BRIDGE_CONFIGURATION`, `BRIDGE_IMPORT_FAILURE`, `BRIDGE_OUTPUT_INVALID`, `BRIDGE_TIMEOUT` | Timeout only, within budget |
| Provider | `PROVIDER_RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_RESPONSE_UNKNOWN` | First three, within budget |
| Run lifecycle | `RUN_CANCELED`, `RUN_DEADLINE_EXCEEDED`, `REPORT_WRITE_FAILED` | No automatic rerun |

Raw exception messages, proxy details, URLs, headers, response bodies, and subprocess stderr are not report fields.

## Aggregate run report

```json
{
  "schemaVersion": 1,
  "run": {
    "status": "completed_with_failures",
    "preset": "safe",
    "dryRun": false,
    "startedAt": "2026-08-03T16:00:00Z",
    "durationMs": 4120
  },
  "compatibility": {
    "adapterVersion": "1",
    "python": ">=3.10",
    "socialscanApi": "pinned-at-release"
  },
  "aggregate": {
    "queries": 2,
    "platformChecksRequested": 4,
    "available": 1,
    "taken": 1,
    "unknown": 1,
    "error": 1,
    "attempts": 5,
    "retries": 1,
    "failuresByCode": {
      "PROVIDER_RATE_LIMITED": 1,
      "BRIDGE_TIMEOUT": 1
    }
  }
}
```

Allowed run statuses are `planned`, `completed`, `completed_with_failures`, `canceled`, and `failed`. Reports contain aggregate counts only: no raw handles, emails, provider payloads, account/profile data, provider URLs, proxy data, or raw exceptions.

## Reserved HTTP contract (TEX-34)

https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required may later wrap the same request/report schemas:

- `POST /v1/runs` → `202 Accepted` with `{ "runId": "opaque", "statusUrl": "/v1/runs/opaque" }`;
- `GET /v1/runs/{runId}` → `200` with sanitized state/progress, `404` when unknown, `410` after retention expiry;
- `POST /v1/runs/{runId}/cancel` → `202` while cancellation is pending;
- `GET /v1/runs/{runId}/report` → `200` only after a report exists, otherwise `409`.

This status-polling API is reserved, not implemented by TEX-30 or approved by these docs. Authentication, local-only defaults, idempotency keys, storage, and streaming remain TEX-34 decisions.

## SocialScan compatibility release gate

Before release, maintainers must pin or otherwise identify the supported SocialScan package/API version, document the exact import and result fields, run offline contract fixtures, and perform a separately approved compatibility check. Any upstream API drift closes the gate until mappings and fixtures are reviewed. Python 3.10+ is a release requirement.
