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

  test('uses a valid Content-Length precheck without reading the body', async () => {
    const app = createDashboardApp()
    let bodyRead = false
    const body = new ReadableStream({
      pull(controller) {
        bodyRead = true
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    }, { highWaterMark: 0 })
    const response = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(64 * 1024 + 1),
        },
        body,
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Request body is too large.' })
    expect(bodyRead).toBe(false)
  })

  test('cancels streaming JSON bodies as soon as the byte limit is exceeded', async () => {
    const app = createDashboardApp()
    let canceled = false
    let thirdChunkRequested = false
    let chunkIndex = 0
    const body = new ReadableStream({
      pull(controller) {
        chunkIndex += 1
        if (chunkIndex === 1) controller.enqueue(new Uint8Array(40 * 1024).fill(0x20))
        else if (chunkIndex === 2) controller.enqueue(new Uint8Array(25 * 1024).fill(0x20))
        else {
          thirdChunkRequested = true
          controller.enqueue(new TextEncoder().encode('PRIVATE_STREAM_CONTENT'))
        }
      },
      cancel() {
        canceled = true
      },
    }, { highWaterMark: 0 })

    const response = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Request body is too large.' })
    expect(canceled).toBe(true)
    expect(thirdChunkRequested).toBe(false)
  })

  test('decodes valid UTF-8 split across streaming chunks', async () => {
    const app = createDashboardApp()
    const bytes = new TextEncoder().encode(
      JSON.stringify({ handles: ['álïçé'], platforms: ['bluesky'], throttle: 'Safe' })
    )
    const split = bytes.indexOf(0xc3) + 1
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split))
        controller.enqueue(bytes.slice(split))
        controller.close()
      },
    })

    const response = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    )

    expect(response.status).toBe(201)
  })

  test('returns generic errors for absent and errored body streams', async () => {
    const app = createDashboardApp()
    const absent = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    )
    expect(absent.status).toBe(400)
    expect(await absent.json()).toEqual({ error: 'Request body must contain valid JSON.' })

    const secret = 'PRIVATE_STREAM_ERROR_CONTENT'
    const errored = await app.fetch(
      new Request('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream({
          start(controller) {
            controller.error(new Error(secret))
          },
        }),
      })
    )
    const errorText = await errored.text()
    expect(errored.status).toBe(400)
    expect(errorText).toContain('Request body must contain valid JSON.')
    expect(errorText).not.toContain(secret)
  })
})
