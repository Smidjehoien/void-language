import { afterEach, describe, expect, test } from 'bun:test'
import { createDashboardApp } from '../dashboard/app.js'
import { LocalSafeExecutor } from '../dashboard/executor.js'
import { RunStore } from '../dashboard/run-store.js'
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

const startServer = (app = createDashboardApp()) => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

const waitForState = async (base, id, target) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await fetch(`${base}/api/runs/${id}`).then((response) => response.json())
    if (run.state === target) return run
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${target}`)
}

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

  test('serves the same allowlisted report on screen and as a safe JSON attachment', async () => {
    const base = startServer()
    const secret = 'private.person@example.test'
    const nestedSecret = 'NESTED_PRIVATE_VALUE_7f3a'

    const page = await fetch(base)
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain('Safe local executor')
    expect(html).toContain('Download JSON report')
    expect(html).toContain('id="download" href="" download hidden')
    expect(html).toMatch(
      /\}\)\.catch\(\(\) => \{\s+if \(runId !== reportRunId\) return\s+download\.hidden = true\s+download\.removeAttribute\('href'\)\s+report\.textContent = 'Report is no longer available\.'\s+\}\)/
    )
    expect(html).not.toContain(secret)

    const createdResponse = await postJson(`${base}/api/runs`, {
      handles: [secret],
      platforms: ['mastodon'],
      throttle: 'Fast',
      ignored: { nested: { secret: nestedSecret } },
    })
    const createdText = await createdResponse.text()
    expect(createdResponse.status).toBe(201)
    expect(createdText).not.toContain(secret)
    expect(createdText).not.toContain(nestedSecret)
    const created = JSON.parse(createdText)

    const pendingDownload = await fetch(`${base}/api/runs/${created.id}/download`)
    expect(pendingDownload.status).toBe(409)
    expect(await pendingDownload.json()).toEqual({ error: 'Report is available only after completion.' })

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

    const run = await waitForState(base, created.id, 'completed')
    expect(run.state).toBe('completed')
    expect(JSON.stringify(run)).not.toContain(secret)

    const reportResponse = await fetch(`${base}/api/runs/${created.id}/report`)
    const report = await reportResponse.json()
    expect(reportResponse.status).toBe(200)
    expect(reportResponse.headers.get('content-disposition')).toBeNull()
    expect(report.execution.executor).toBe('local-safe')

    const downloadResponse = await fetch(
      `${base}/api/runs/${created.id}/download?filename=${encodeURIComponent(secret)}`
    )
    const downloadText = await downloadResponse.text()
    expect(downloadResponse.status).toBe(200)
    expect(downloadResponse.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(downloadResponse.headers.get('content-disposition')).toBe(
      `attachment; filename="void-report-${created.id}.json"`
    )
    expect(downloadResponse.headers.get('cache-control')).toBe('no-store')
    expect(downloadResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect(JSON.parse(downloadText)).toEqual(report)
    expect(Object.keys(report)).toEqual(['runId', 'generatedAt', 'status', 'aggregates', 'execution', 'summary'])
    expect(Object.keys(report.aggregates)).toEqual([
      'handleCount',
      'platformCount',
      'platforms',
      'providerRecordsCollected',
    ])
    expect(Object.keys(report.execution)).toEqual([
      'throttle',
      'externalCollectionPerformed',
      'executor',
    ])
    expect(downloadText).not.toContain(secret)
    expect(downloadText).not.toContain('private.person')
    expect(downloadText).not.toContain(nestedSecret)
    expect(downloadResponse.headers.get('content-disposition')).not.toContain(secret)

    expect((await fetch(`${base}/api/auth`)).status).toBe(404)
    expect((await postJson(`${base}/api/login`, {})).status).toBe(404)
  })

  test('does not fabricate downloads for unknown, canceled, expired, or failed runs', async () => {
    const base = startServer()

    const unknown = await fetch(`${base}/api/runs/00000000-0000-4000-8000-000000000000/download`)
    expect(unknown.status).toBe(404)

    const canceledRun = await postJson(`${base}/api/runs`, {
      handles: ['cancel-private'],
      platforms: ['reddit'],
      throttle: 'Fast',
    }).then((response) => response.json())
    await postJson(`${base}/api/runs/${canceledRun.id}/cancel`, {})
    const canceled = await fetch(`${base}/api/runs/${canceledRun.id}/download`)
    expect(canceled.status).toBe(410)
    expect(await canceled.json()).toEqual({ error: 'Report is unavailable because the run was canceled.' })

    const expiringStore = new RunStore({ executor: new LocalSafeExecutor(), approvalTtlMs: 5 })
    const expiringBase = startServer(createDashboardApp({ store: expiringStore }))
    const expiringRun = await postJson(`${expiringBase}/api/runs`, {
      handles: ['expire-private'],
      platforms: ['bluesky'],
      throttle: 'Fast',
    }).then((response) => response.json())
    await waitForState(expiringBase, expiringRun.id, 'canceled')
    const expired = await fetch(`${expiringBase}/api/runs/${expiringRun.id}/download`)
    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({ error: 'Report is unavailable because run approval expired.' })

    const failedBase = startServer(
      createDashboardApp({
        executor: {
          async execute() {
            throw new Error('PRIVATE_EXECUTOR_FAILURE')
          },
        },
      })
    )
    const failedRun = await postJson(`${failedBase}/api/runs`, {
      handles: ['failed-private'],
      platforms: ['mastodon'],
      throttle: 'Fast',
    }).then((response) => response.json())
    await postJson(`${failedBase}/api/runs/${failedRun.id}/approve`, {
      approved: true,
      ethicsAccepted: true,
    })
    await waitForState(failedBase, failedRun.id, 'failed')
    const failed = await fetch(`${failedBase}/api/runs/${failedRun.id}/download`)
    const failedText = await failed.text()
    expect(failed.status).toBe(422)
    expect(failedText).toContain('Report is unavailable because the run failed.')
    expect(failedText).not.toContain('PRIVATE_EXECUTOR_FAILURE')

    for (const response of [unknown, canceled, expired, failed]) {
      expect(response.headers.get('content-disposition')).toBeNull()
    }
  })

  test('returns a conflict while a run is actively executing', async () => {
    const executor = {
      async execute({ signal }) {
        await new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Run canceled', 'AbortError')),
            { once: true }
          )
        })
      },
    }
    const base = startServer(createDashboardApp({ executor }))
    const run = await postJson(`${base}/api/runs`, {
      handles: ['running-private'],
      platforms: ['bluesky'],
      throttle: 'Fast',
    }).then((response) => response.json())
    await postJson(`${base}/api/runs/${run.id}/approve`, {
      approved: true,
      ethicsAccepted: true,
    })

    const running = await fetch(`${base}/api/runs/${run.id}/download`)
    expect(running.status).toBe(409)
    expect(await running.json()).toEqual({ error: 'Report is available only after completion.' })
    await postJson(`${base}/api/runs/${run.id}/cancel`, {})
  })
})
