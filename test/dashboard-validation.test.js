import { describe, expect, test } from 'bun:test'
import { createDashboardApp } from '../dashboard/app.js'
import { ALLOWED_PLATFORMS, THROTTLE_PRESETS } from '../dashboard/config.js'
import { validateRunInput } from '../dashboard/validation.js'

describe('run input validation', () => {
  test('accepts configured platforms and deterministic presets', () => {
    expect(validateRunInput({ handles: ['alice'], platforms: ['bluesky'], throttle: 'Safe' })).toEqual({
      handles: ['alice'],
      platforms: ['bluesky'],
      throttle: 'Safe',
    })
    expect(ALLOWED_PLATFORMS).toEqual(['bluesky', 'mastodon', 'reddit'])
    expect(THROTTLE_PRESETS.Safe.stepDelayMs).toBe(120)
  })

  test.each([
    [{ handles: 'alice', platforms: ['bluesky'], throttle: 'Safe' }, 'handles must be an array'],
    [{ handles: [], platforms: ['bluesky'], throttle: 'Safe' }, 'handles must contain'],
    [{ handles: ['a', 'A'], platforms: ['bluesky'], throttle: 'Safe' }, 'Duplicate handles'],
    [{ handles: ['alice'], platforms: ['bluesky', 'bluesky'], throttle: 'Safe' }, 'Duplicate platforms'],
    [{ handles: ['alice'], platforms: ['https://example.com'], throttle: 'Safe' }, 'unsupported'],
    [{ handles: ['https://example.com/alice'], platforms: ['bluesky'], throttle: 'Safe' }, 'URLs are not accepted'],
    [{ handles: ['alice'], platforms: ['provider-secret'], throttle: 'Warp' }, 'throttle must be'],
  ])('rejects invalid input without reflecting values', (input, expected) => {
    expect(() => validateRunInput(input)).toThrow(expected)
    try {
      validateRunInput(input)
    } catch (error) {
      expect(error.message).not.toContain('provider-secret')
      expect(error.message).not.toContain('https://example.com')
    }
  })

  test('nested malicious values produce shape-only errors', async () => {
    const app = createDashboardApp()
    const secret = 'PRIVATE_HANDLE_7f3a<script>alert(1)</script>'
    const response = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handles: [{ value: secret, nested: { secret } }],
          platforms: ['bluesky'],
          throttle: 'Safe',
          ignored: { secret },
        }),
      })
    )
    const text = await response.text()
    expect(response.status).toBe(400)
    expect(text).not.toContain(secret)
    expect(text).not.toContain('PRIVATE_HANDLE')
  })

  test('rejects oversized JSON bodies before validation', async () => {
    const app = createDashboardApp()
    const response = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
      })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Request body is too large.' })
  })
})
