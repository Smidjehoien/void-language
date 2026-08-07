import { afterEach, describe, expect, test } from 'bun:test'
import { createDashboardApp } from '../dashboard/app.js'
import { resolveServerOptions } from '../dashboard/server.js'

const servers = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

const postJson = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('HTTP dashboard', () => {
  test('defaults to loopback and requires opt-in for other binds', () => {
    expect(resolveServerOptions(['bun', 'server.js'], {})).toEqual({ hostname: '127.0.0.1', port: 3000 })
    expect(() => resolveServerOptions(['bun', 'server.js', '--host=0.0.0.0'], {})).toThrow(
      'requires --allow-non-loopback'
    )
    expect(() => resolveServerOptions(['bun', 'server.js', '--host=localhost'], {})).toThrow(
      'requires --allow-non-loopback'
    )
    expect(resolveServerOptions(['bun', 'server.js', '--host=localhost', '--allow-non-loopback'], {})).toEqual({
      hostname: 'localhost',
      port: 3000,
    })
    expect(resolveServerOptions(['bun', 'server.js', '--host=::1'], {})).toEqual({
      hostname: '::1',
      port: 3000,
    })
    expect(resolveServerOptions(['bun', 'server.js', '--host=0.0.0.0', '--allow-non-loopback'], {})).toEqual({
      hostname: '0.0.0.0',
      port: 3000,
    })
  })

  test('serves UI, lifecycle endpoints, SSE, and inline-only report JSON', async () => {
    const app = createDashboardApp()
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
    servers.push(server)
    const base = `http://127.0.0.1:${server.port}`
    const secret = 'hidden-handle-123'

    const page = await fetch(base)
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain('Safe local executor')
    expect(html).not.toContain('Download report')

    const createdResponse = await postJson(`${base}/api/runs`, {
      handles: [secret],
      platforms: ['mastodon'],
      throttle: 'Fast',
    })
    const createdText = await createdResponse.text()
    expect(createdResponse.status).toBe(201)
    expect(createdText).not.toContain(secret)
    const created = JSON.parse(createdText)

    const eventsResponse = await fetch(`${base}/api/runs/${created.id}/events`)
    expect(eventsResponse.headers.get('content-type')).toContain('text/event-stream')
    const reader = eventsResponse.body.getReader()
    const firstEvent = new TextDecoder().decode((await reader.read()).value)
    expect(firstEvent).toContain('pending_approval')
    expect(firstEvent).not.toContain(secret)
    await reader.cancel()

    const rejectedApproval = await postJson(`${base}/api/runs/${created.id}/approve`, {
      approved: true,
      ethicsAccepted: false,
    })
    expect(rejectedApproval.status).toBe(400)

    const approval = await postJson(`${base}/api/runs/${created.id}/approve`, {
      approved: true,
      ethicsAccepted: true,
    })
    expect(approval.status).toBe(202)

    let run
    for (let attempt = 0; attempt < 100; attempt++) {
      run = await fetch(`${base}/api/runs/${created.id}`).then((response) => response.json())
      if (run.state === 'completed') break
      await Bun.sleep(10)
    }
    expect(run.state).toBe('completed')
    expect(JSON.stringify(run)).not.toContain(secret)

    const reportResponse = await fetch(`${base}/api/runs/${created.id}/report`)
    const reportText = await reportResponse.text()
    expect(reportResponse.status).toBe(200)
    expect(reportResponse.headers.get('content-disposition')).toBeNull()
    expect(reportText).not.toContain(secret)
    expect(JSON.parse(reportText).execution.executor).toBe('local-safe')

    expect((await fetch(`${base}/api/runs/${created.id}/download`)).status).toBe(404)
    expect((await fetch(`${base}/api/auth`)).status).toBe(404)
    expect((await postJson(`${base}/api/login`, {})).status).toBe(404)
  })
})
