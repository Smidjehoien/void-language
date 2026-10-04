# Void language

Void has two separate local entry points:

- a character-chat CLI that loads a character pack and sends conversation prompts to OpenAI;
- a deterministic local dashboard executor that validates a workflow and produces sanitized reports without external collection.

There is no provider/orchestrator integration, authentication, persistence, or Python implementation in this repository. The adapter boundary in `dashboard/executor.js` is only a future integration point; it is not a provider backend.

## Setup

Install Bun, then install the locked dependencies and run the tests:

```sh
bun install --frozen-lockfile
bun test
```

The character-chat CLI requires an OpenAI API key. Avoid putting the key in a committed file, an example config, or a command that will be saved in shell history. For an interactive shell, enter it without echoing it:

```sh
read -rsp "OpenAI API key: " OPENAI_API_KEY; echo
export OPENAI_API_KEY
```

Unset it when finished with the session:

```sh
unset OPENAI_API_KEY
```

The dashboard does not require an API key because its current executor performs no external collection.

## Character-chat CLI

### Run the agent

With no options, the CLI loads `character-packs/nebula-darkwhisper.json`:

```sh
bun index.js
```

Type a message at the prompt. Enter `exit` to close the chat. The CLI calls the OpenAI chat API with the selected pack's character, setting, traits, description, and vocabulary. It expects the model response to follow the pack's response instruction; the CLI does not parse or validate that response format.

Show the available options without requiring `OPENAI_API_KEY`:

```sh
env -u OPENAI_API_KEY bun index.js --help
```

### Select a character pack

Named packs are resolved from `character-packs/` in this order:

1. `<name>.json`
2. `<name>.yaml`
3. `<name>.yml`

For example:

```sh
bun index.js --pack nebula-darkwhisper
```

`--pack-file` accepts a local path or an HTTPS URL and supports only `.json`, `.yaml`, and `.yml`:

```sh
bun index.js --pack-file examples/character-pack.yaml
bun index.js --pack-file https://example.test/packs/character-pack.yaml
```

If both options are supplied, `--pack-file` wins and the CLI prints a note. HTTP pack URLs are rejected; remote packs must use HTTPS. A missing named pack, missing local file, unsupported extension, invalid YAML/JSON, or invalid pack shape stops the CLI with an error before the chat starts. The default pack is used only when neither option is supplied.

### Character-pack shape

Every pack must contain these fields:

- top-level strings: `id`, `displayName`, `character`, `setting`;
- top-level arrays of non-empty strings: `traits`;
- top-level finite number: `health` from `0` through `1000`;
- `description` object with string fields `name`, `gender`, `complexion`, `hair`, `eyes` and numeric `age`;
- `vocab` object with non-empty string arrays `emotions`, `actions`, and `objects`.

The compact YAML example in [`examples/character-pack.yaml`](examples/character-pack.yaml) is a valid pack for local testing. The loader validates the complete shape before the CLI creates an OpenAI client.

### Response format

The language specification asks the model to answer in this format:

```text
[emotions][actions][objects][health] dialog
```

Representative labeled example:

```text
[calm][look][moon][100] The night keeps its counsel, traveler.
```

The labels are drawn from the selected pack's `vocab` lists. The loader validates the pack's numeric `health` field, but the CLI does not parse or update model health; this is a prompt-level convention, not a separately parsed output protocol.

## Local dashboard

### Start and configure it

Start the dashboard with its default loopback bind and port:

```sh
bun run dashboard
```

Open `http://127.0.0.1:3000`. The server accepts these command-line options:

```sh
bun run dashboard --host=127.0.0.1 --port=3000
```

The equivalent environment variables are `DASHBOARD_HOST`, `DASHBOARD_PORT`, and `DASHBOARD_ALLOW_NON_LOOPBACK=1`. CLI `--host=` and `--port=` values take precedence over environment variables. The repository does not auto-load `.env` files; export variables in the shell or use a process manager's environment configuration. [`examples/dashboard.env.example`](examples/dashboard.env.example) lists the supported names without containing an API key.

Only the literal loopback hosts `127.0.0.1` and `::1` are accepted by default. Hostnames such as `localhost` are not resolved or trusted as loopback. A non-loopback bind requires explicit opt-in:

```sh
bun run dashboard --host=0.0.0.0 --allow-non-loopback
# or: DASHBOARD_HOST=0.0.0.0 DASHBOARD_ALLOW_NON_LOOPBACK=1 bun run dashboard
```

### Configured platforms and throttling

`GET /api/config` reports the current allowlist and presets. The configured platforms are:

| Preset | Delay between steps | Maximum handles | Maximum platforms |
| --- | ---: | ---: | ---: |
| `Safe` | 120 ms | 5 | 2 |
| `Balanced` | 60 ms | 10 | 3 |
| `Fast` | 20 ms | 20 | 3 |

The accepted platform names are `bluesky`, `mastodon`, and `reddit`. These names are configuration allowlist entries only; the current executor does not query any of them.

### Run lifecycle, SSE, and reports

The browser dashboard performs the same lifecycle as these API calls:

1. Create a validated run. It starts in `pending_approval` and returns sanitized metadata only:

   ```sh
   curl -sS http://127.0.0.1:3000/api/runs \
     -H 'content-type: application/json' \
     -d '{"handles":["alice"],"platforms":["bluesky"],"throttle":"Safe"}'
   ```

2. Approve it explicitly with the ethics acknowledgement. Replace `<run-id>` with the returned `id`:

   ```sh
   curl -sS -X POST http://127.0.0.1:3000/api/runs/<run-id>/approve \
     -H 'content-type: application/json' \
     -d '{"approved":true,"ethicsAccepted":true}'
   ```

3. Inspect sanitized lifecycle metadata with `GET /api/runs/<run-id>` or stream sanitized events with `GET /api/runs/<run-id>/events`. The events endpoint uses Server-Sent Events and closes after `completed`, `canceled`, or `failed`. A pending or running run can be stopped with `POST /api/runs/<run-id>/cancel`.

4. After completion, render the report with `GET /api/runs/<run-id>/report` or download the same JSON with `GET /api/runs/<run-id>/download`:

   ```sh
   curl -sS http://127.0.0.1:3000/api/runs/<run-id>/report
   curl -sS -OJ http://127.0.0.1:3000/api/runs/<run-id>/download
   ```

The download is available only for a completed run and uses a server-generated filename containing only the run ID. The on-screen report and download are the same sanitized report DTO. A representative report is in [`examples/run-report.json`](examples/run-report.json).

Report endpoint status behavior:

- `404`: the run ID is unknown;
- `409`: the run is pending approval or still running;
- `410`: the run was canceled or approval expired;
- `422`: the executor failed;
- `200`: the completed report is available.

### Current dashboard executor

`LocalSafeExecutor` is deterministic and performs no external collection. It checks the configured platform boundaries, waits according to the selected local throttle preset, and returns an aggregate report with zero provider records. It does not query Bluesky, Mastodon, Reddit, or any other provider, and it does not fabricate provider data.

The current dashboard always requires explicit approval and an ethics acknowledgement before execution. This is a workflow guardrail; any future adapter that performs non-read-only actions must retain human approval before those actions. No provider/orchestrator integration is implemented today.

## Security and privacy

- The dashboard binds to loopback by default. Do not expose it to an untrusted network; there is no authentication or authorization implementation, and there are no login or credential routes.
- The current dashboard executor performs no external collection. Configured platform names do not cause provider queries.
- Run and event data is process-memory-only and disappears when the server restarts. At most 100 runs and 100 events per run are retained; when capacity is reached, the oldest terminal run is removed and active runs are not evicted. Unapproved runs expire after 15 minutes.
- Raw handle inputs are cleared when a run completes, fails, is canceled, or approval expires. Public lifecycle events and reports contain counts, configured platform names, status, and aggregate fields—not raw handles or provider records.
- Do not put API keys, real private handles, or other personal/provider data in example files. Use only data you are authorized to process.
- Follow the ethics notice shown by the dashboard: use authorized, lawful inputs and do not use this tool for harassment, stalking, doxxing, discrimination, or attempts to identify private individuals.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Missing OPENAI_API_KEY environment variable` | Export the key in the current process environment, then rerun `bun index.js`. `--help` works without it. |
| `Pack not found` | Check the name under `character-packs/`; named resolution is `.json`, then `.yaml`, then `.yml`. |
| `Pack validation failed` or a parse error | Compare the file with the required shape above and [`examples/character-pack.yaml`](examples/character-pack.yaml). Arrays must be non-empty, and `health`/`description.age` must be numbers. |
| `Unsupported pack file extension` | Use `.json`, `.yaml`, or `.yml` with `--pack-file`. |
| `Remote pack URLs must use HTTPS` | Replace an `http://` pack URL with an `https://` URL, or download the file and pass a local path. |
| `Non-loopback dashboard binding requires ...` | Keep the default loopback bind, or explicitly pass `--allow-non-loopback` / set `DASHBOARD_ALLOW_NON_LOOPBACK=1`. |
| `Report is available only after completion` | The run is pending approval or still running; wait for the SSE terminal event or poll the run status. |
| `Report is unavailable because ...` | Canceled and approval-expired runs return `410`; failed runs return `422`. No report is fabricated for these states. |
| Expected provider results do not appear | This repository does not query providers. The configured platform list and local executor demonstrate validation and reporting only. |

## Tests

```sh
bun test
```

