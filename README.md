# Interactive Text-based Conversational Experience with Nebula Darkwhisper

This project aims to **create an interactive text-based conversational experience** with a unique character named *Nebula Darkwhisper*, a space pagan/witch. By leveraging the power of the OpenAI API and pre-defined lists of emotions, actions, and objects, the user engages in dynamic and immersive dialogue with Nebula. 

## Key Features

- **Character's personality**: Shaped by specific *Ocean and Dark Triad personality traits*, providing depth and consistency in the interactions.
- **Pre-defined lists**:
  - *Emotions*
  - *Actions*
  - *Objects*
- **Engaging experience**: Allows users to explore the character's intriguing background and personality while enjoying a creative and entertaining exchange.

## Local HTTP dashboard

TEX-34's shared dashboard core is available as a separate entry point, so the existing character-chat CLI remains unchanged:

```sh
bun run dashboard
```

Open `http://127.0.0.1:3000`. Without explicit opt-in, only the literal loopback addresses `127.0.0.1` and `::1` are accepted; hostnames such as `localhost` are not resolved or trusted. Any other bind requires:

```sh
bun run dashboard --host=0.0.0.0 --allow-non-loopback
```

The dashboard provides:

- strict handle, configured-platform, and Safe/Balanced/Fast preset validation;
- an explicit human approval and ethics acknowledgement step before execution;
- cancelable in-memory runs and sanitized Server-Sent Events;
- an on-screen aggregate report containing no handles or provider records;
- a completed-run-only JSON download containing the exact same sanitized report DTO;
- bounded storage of at most 100 runs and 100 events per run.

Run and event data is process-memory-only and disappears when the server restarts. Completed, canceled, failed, and approval-expired runs have their raw handle inputs cleared immediately. Unapproved runs expire after 15 minutes. When capacity is reached, the oldest terminal run is removed; active runs are never evicted.

### Current executor limitation

There is no provider/orchestrator backend in this repository. The included `LocalSafeExecutor` is deterministic, performs no external collection, and does not fabricate provider data. The adapter boundary in `dashboard/executor.js` is the intended integration point for a future authorized provider implementation.

Credential authentication remains intentionally excluded. There are no login, credential prompt, or authentication routes in this dashboard.

### Dashboard API

- `POST /api/runs` creates a validated run awaiting explicit approval.
- `POST /api/runs/:id/approve` approves a run after the ethics acknowledgement.
- `POST /api/runs/:id/cancel` cancels a non-terminal run.
- `GET /api/runs/:id` returns sanitized lifecycle metadata.
- `GET /api/runs/:id/events` streams sanitized lifecycle events.
- `GET /api/runs/:id/report` returns the completed sanitized report for on-screen rendering.
- `GET /api/runs/:id/download` downloads that same completed report as JSON with a server-generated, run-ID-only filename.

Report endpoints never reconstruct output from raw handles or executor errors. Unknown runs return `404`; pending or running reports return `409`; canceled or approval-expired reports return `410`; and failed reports return `422`. All JSON responses disable caching and content sniffing. Downloads are available only after completion.

### Tests

```sh
bun test
```

