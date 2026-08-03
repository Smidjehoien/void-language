# Agent harness decision log

This log records the outcome of https://linear.app/texas/issue/TEX-30/research-spike-agent-architecture-and-design. Labels mean:

- **Adopted:** required by the research design.
- **Provisional:** recommended, but must be confirmed through implementation/release review.
- **Deferred:** intentionally assigned to another issue.
- **Unresolved:** requires evidence or stakeholder choice.

## Decisions

| Status | Decision | Rationale |
| --- | --- | --- |
| **Provisional** | Use a separate, non-interactive Bun CLI/harness in this repository. | The repository's current runtime is Bun/JavaScript, and a separate entry point keeps batch orchestration testable and isolated from the chat application. |
| **Adopted** | Do not integrate the harness into `index.js`. | `index.js` is an interactive OpenAI-backed character-chat loop with readline state and chat history. Agent availability runs have different inputs, lifecycle, privacy, timeout, and failure semantics. |
| **Adopted** | Use deterministic workflow planning, not arbitrary autonomous LLM planning. | Platform selection, chunking, retry budgets, and report aggregation must be reproducible, reviewable, bounded, and independent of prompt/model behavior. |
| **Provisional** | Use bounded Bun workers plus a narrow Node-to-Python bridge. | Bun can own CLI lifecycle, cancellation, concurrency, and reports while Python 3.10+ provides the SocialScan integration required by the approved baseline. A narrow JSON boundary limits leakage and API coupling. |
| **Adopted** | Normalize errors and persist only aggregate reports/logs. | Stable classifications support retries and operations without exposing raw inputs, provider payloads, proxy data, or exceptions. |
| **Provisional** | Treat https://github.com/Smidjehoien/void-language/pull/6 as a prototype/evidence source. | PR #6 demonstrates the separate CLI, bounded workers, retry behavior, Python bridge, and aggregate report. It is open and has non-green checks, so TEX-30 does not treat its code or exact interfaces as merged, approved, or final. These docs ratify the broad shape while revising result semantics to explicitly preserve `available`, `taken`, `unknown`, and `error`. |
| **Adopted** | Preserve Python 3.10+ as a release requirement. | This matches the approved https://linear.app/texas/issue/TEX-11/create-sentient-androids baseline and supports maintained typing/async behavior. The CLI must fail compatibility preflight on older versions. |
| **Adopted** | Pin/document the supported SocialScan API before release. | This repository does not currently contain SocialScan, and provider/library result shapes can drift. The import path, version, platform mapping, and normalization fixtures are a release gate. |
| **Deferred** | HTTP dashboard and status polling. | The transport contract is reserved for https://linear.app/texas/issue/TEX-34/http-ui-dashboard-required and is not implemented or approved by TEX-30. |
| **Deferred** | Web3 anchoring. | https://linear.app/texas/issue/TEX-35/web3-anchoring-hash-only-evm-attestation-optional owns optional, disabled-by-default SHA-256 anchoring after sanitized report creation. No input or report data goes on-chain. |
| **Adopted** | Keep safety presets bounded and require live-run approval. | Read-only checks still create platform, privacy, and rate-limit risk. Fast is a bounded preset, not a bypass mode. See https://linear.app/texas/issue/TEX-32/safety-and-ethics-safeguards. |

## Repository/runtime mismatch

The TEX-30 kickoff and earlier TEX-11 text refer to `Smidjehoien/iotosint`, `socialscan/agents/`, and a primarily Python repository. The assigned target is `Smidjehoien/void-language`, whose `main` branch is a small Bun/JavaScript character-chat project and contains no SocialScan package. This design follows the actual target repository: separate Bun orchestration with a Python bridge, rather than pretending the Python package is local. Moving the work to `iotosint` would require an explicit scope/repository decision and a revised architecture.

## Dependencies and blockers

- Stakeholder approval is recorded in TEX-11, but implementation beyond the research/prototype scope remains subject to its approval/allowlist policy and any later approval changes.
- https://linear.app/texas/issue/TEX-31/prototype-agent-harness-orchestrator-and-async-queries remains dependent on the Python baseline and compatibility evidence.
- https://linear.app/texas/issue/TEX-32/safety-and-ethics-safeguards must convert these policy values into enforced configuration and tests.
- SocialScan is neither pinned nor installed by `main`; supported package/API and provider versions remain a release blocker.
- PR #6 checks are not green, so it cannot serve as release evidence without resolving or explicitly dispositioning those repository/check failures.

## Deviations and open decisions

- **Deviation:** repository and language differ from the kickoff's `iotosint`/Python placement; provisional Bun + bridge architecture used instead.
- **Revision to PR #6:** v1 reporting should count four explicit outcomes rather than a generic `matches` total.
- **Unresolved:** initial platform scope—top five versus every compatible platform. Default recommendation: start with an approved top-five manifest, then expand through compatibility review.
- **Unresolved:** exact SocialScan package/API version and whether its async function is stable enough for the bridge.
- **Unresolved:** benchmark environment and acceptable subprocess strategy (one process per query versus a bounded persistent bridge).
- **Unresolved:** final retention duration and whether run metadata needs local persistence for resumability; raw inputs remain prohibited either way.
