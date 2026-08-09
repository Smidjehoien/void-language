export const ALLOWED_PLATFORMS = Object.freeze(['bluesky', 'mastodon', 'reddit'])

export const THROTTLE_PRESETS = Object.freeze({
  Safe: Object.freeze({ stepDelayMs: 120, maxHandles: 5, maxPlatforms: 2 }),
  Balanced: Object.freeze({ stepDelayMs: 60, maxHandles: 10, maxPlatforms: 3 }),
  Fast: Object.freeze({ stepDelayMs: 20, maxHandles: 20, maxPlatforms: 3 }),
})

export const RUN_RETENTION = Object.freeze({
  maxRuns: 100,
  maxEventsPerRun: 100,
  approvalTtlMs: 15 * 60 * 1000,
})

export const ETHICS_NOTICE =
  'Use only authorized, lawful inputs. Do not use this tool for harassment, stalking, doxxing, discrimination, or attempts to identify private individuals.'
