# Agent harness safeguards

**Status:** Adopted policy baseline for design; implementation details remain gated by https://linear.app/texas/issue/TEX-32/safety-and-ethics-safeguards.

The harness is limited to read-only checks of public availability metadata. It must not circumvent CAPTCHAs, access controls, authentication, robots restrictions, rate limits, or platform Terms of Service. It must not collect non-public personal data or persist raw personally identifying inputs.

## Bounded presets

All presets are ceilings, not throughput promises. Provider-specific limits may reduce them.

| Preset | Concurrency | Retries per check | Bridge timeout | Overall run deadline | Approval |
| --- | ---: | ---: | ---: | ---: | --- |
| Safe | 2 | 1 | 30 s | 15 min | Explicit approval before live dispatch |
| Balanced | 4 | 2 | 30 s | 10 min | Explicit approval before live dispatch |
| Fast | 8 | 2 | 20 s | 10 min | Explicit per-run Fast approval |

Retries use capped exponential backoff with jitter and safe `Retry-After` handling. Fast remains bounded and policy-compliant: it does not unlock proxy rotation, bypasses, extra retries, hidden platforms, or automatic approval. A provider manifest may impose a lower concurrency, retry, or pacing ceiling than the selected preset.

## Opt-in and approval policy

- `--dry-run` performs validation, compatibility checks that do not contact providers, plan construction, and fixture execution only.
- Every live run requires a deliberate approval after the resolved plan displays platform count, query count, preset, maximum calls, retry budget, timeout, and retention behavior.
- Non-interactive execution requires an explicit `--approve-live` (or equivalent signed local configuration) from an authorized operator; approval is never inferred from input presence.
- Fast requires a separate, visible per-run acknowledgment. Stored defaults may select Safe or Balanced, not Fast.
- Any capability beyond read-only public checks, including writes or authenticated/private data access, requires a new design review and human confirmation gate.
- Implementation work remains gated by the stakeholder approval requirements and allowlist recorded in https://linear.app/texas/issue/TEX-11/create-sentient-androids.

## Prohibited behavior

- CAPTCHA, access-control, authentication, robots, rate-limit, or ToS circumvention.
- Collection or inference of non-public personal data.
- Persistence of raw handles, emails, provider payloads, profile/account data, or per-query results.
- Logging proxy credentials, proxy URLs, auth headers/tokens, raw exceptions, subprocess stdout/stderr, or provider response bodies.
- Automated live-provider tests in CI, scheduled jobs, or unattended test suites.
- Treating `unknown` or `error` as evidence that an identifier is available or taken.

Proxy support, if ever enabled, is limited to an existing approved provider interface. Secrets are loaded from the runtime environment or a protected secret store, passed only to the adapter that needs them, and represented in logs as a boolean/configuration class—not a value or URL.

## Human confirmation gates

1. **Before live dispatch:** show the sanitized plan and require approval.
2. **Before Fast:** show its higher bounded call rate and require separate approval.
3. **On policy expansion:** stop and require design/stakeholder approval for new platforms, authenticated sources, custom proxy behavior, writes, HTTP exposure, or Web3 anchoring.
4. **After partial/canceled runs:** require a new approval before rerunning failed work; do not automatically replay a report.

## Data retention and logging

- Raw input exists only in the operator-controlled input file and transient process memory. The harness does not create a second raw-input copy.
- Clear transient query values as soon as practical after aggregation and subprocess completion.
- Default aggregate report retention is 30 days; operators may choose a shorter period or immediate deletion. Longer retention requires documented purpose and approval.
- Structured logs contain run state, schema/preset versions, aggregate counts, durations, retry counts, cancellation reason, and stable failure codes.
- Redaction occurs before serialization. Values matching input, credential, URL-with-userinfo, header, proxy, provider-payload, or raw-exception fields are dropped—not merely masked.
- Logs and reports use restrictive file permissions and atomic writes. Console output remains aggregate-only.

## Dry-run, fixtures, and tests

Dry-run validates schemas, limits, approvals, deterministic planning, cancellation wiring, and report construction without provider calls. Tests use synthetic placeholders and checked-in fixture payloads that contain no real handles, emails, credentials, or provider responses copied from live traffic. Fixture adapters cover available/taken/unknown/error, retry exhaustion, rate limits, malformed responses, cancellation, and redaction. Live compatibility checks are manual, narrowly scoped, separately approved, and never automated.
