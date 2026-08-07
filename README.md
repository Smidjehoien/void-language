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

Open `http://127.0.0.1:3000`. The server binds to loopback by default. Binding to another interface requires an explicit opt-in:

```sh
bun run dashboard --host=0.0.0.0 --allow-non-loopback
```

The dashboard provides:

- strict handle, configured-platform, and Safe/Balanced/Fast preset validation;
- an explicit human approval and ethics acknowledgement step before execution;
- cancelable in-memory runs and sanitized Server-Sent Events;
- an on-screen aggregate report containing no handles or provider records;
- bounded storage of at most 100 runs and 100 events per run.

Run and event data is process-memory-only and disappears when the server restarts. Completed, canceled, failed, and approval-expired runs have their raw handle inputs cleared immediately. Unapproved runs expire after 15 minutes. When capacity is reached, the oldest terminal run is removed; active runs are never evicted.

### Current executor limitation

There is no provider/orchestrator backend in this repository. The included `LocalSafeExecutor` is deterministic, performs no external collection, and does not fabricate provider data. The adapter boundary in `dashboard/executor.js` is the intended integration point for a future authorized provider implementation.

Credential authentication and report attachment/download behavior are intentionally not included in this phase while the requested TEX-34 scope is clarified. The report JSON endpoint exists only to render the on-screen report and does not set `Content-Disposition`.

### Tests

```sh
bun test
```

