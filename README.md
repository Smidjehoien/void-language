# Interactive Text-based Conversational Experience with Nebula Darkwhisper

This project aims to **create an interactive text-based conversational experience** with a unique character named *Nebula Darkwhisper*, a space pagan/witch. By leveraging the power of the OpenAI API and pre-defined lists of emotions, actions, and objects, the user engages in dynamic and immersive dialogue with Nebula. 

## Key Features

- **Character's personality**: Shaped by specific *Ocean and Dark Triad personality traits*, providing depth and consistency in the interactions.
- **Pre-defined lists**:
  - *Emotions*
  - *Actions*
  - *Objects*
- **Engaging experience**: Allows users to explore the character's intriguing background and personality while enjoying a creative and entertaining exchange.

## SocialScan agent harness

The repository also includes a separate Bun CLI for running newline-delimited queries through SocialScan with bounded concurrency and retries. It does not change the existing `bun start` application.

### Prerequisites

- Bun
- Python 3
- A Python environment where SocialScan is installed and importable by the selected Python executable

### Usage

Create a private input file with one query per line, then run:

```sh
bun run agent:run -- \
  --input ./queries.txt \
  --output ./report.json \
  --platform github \
  --platform gitlab \
  --concurrency 4 \
  --retries 2 \
  --python python3
```

Required flags are `--input`, `--output`, and at least one repeatable `--platform`. Optional flags are `--concurrency` (default `4`), `--retries` (default `2`), `--python` (default `python3`), and `--help`.

The input is read transiently and is never included in routine console output or the report. Reports contain aggregate values only:

```json
{
  "schemaVersion": 1,
  "aggregate": {
    "totalQueries": 3,
    "successfulQueries": 2,
    "failedQueries": 1,
    "totalAttempts": 4,
    "platformChecksRequested": 6,
    "platformChecksCompleted": 4,
    "matches": 1,
    "failuresByCode": {
      "BRIDGE_TIMEOUT": 1
    }
  }
}
```

The CLI exits `0` once a report is completed, including runs containing individual query failures. It exits nonzero for invalid CLI/configuration, bridge preflight failures, unreadable input, or report write failures.

The Bun process enforces a bounded worker pool, retries only typed transient failures with capped exponential backoff, and continues after individual failures. The Python bridge and adapter expose stable machine codes and deliberately omit queries, provider messages, profile data, URLs, proxy values, standard output/error, and raw exception text. Keep input files private and delete them according to your data-handling policy.

Social platforms may impose rate limits or usage restrictions. Choose conservative concurrency/retry settings and comply with each provider's terms; retries cannot guarantee completion during sustained throttling or outages.

