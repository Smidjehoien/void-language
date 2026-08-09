import { ALLOWED_PLATFORMS, ETHICS_NOTICE, RUN_RETENTION, THROTTLE_PRESETS } from './config.js'
import { LocalSafeExecutor } from './executor.js'
import { dashboardHtml } from './html.js'
import { RunStore } from './run-store.js'
import { InputError, validateApprovalInput, validateRunInput } from './validation.js'

const MAX_REQUEST_BYTES = 64 * 1024

const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  })

const reportDownload = (report) =>
  new Response(JSON.stringify(report), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="void-report-${report.runId}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })

const readBodyWithLimit = async (request) => {
  const reader = request.body?.getReader?.()
  if (!reader) return new Uint8Array()

  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      totalBytes += chunk.byteLength
      if (totalBytes > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {})
        throw new InputError('Request body is too large.')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof InputError) throw error
    throw new InputError('Request body must contain valid JSON.')
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const parseJson = async (request) => {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new InputError('Content-Type must be application/json.')
  }
  const contentLength = request.headers.get('content-length')
  if (/^\d+$/.test(contentLength ?? '') && BigInt(contentLength) > BigInt(MAX_REQUEST_BYTES)) {
    throw new InputError('Request body is too large.')
  }
  try {
    const bytes = await readBodyWithLimit(request)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof InputError) throw error
    throw new InputError('Request body must contain valid JSON.')
  }
}

const routeId = (pathname, suffix = '') => {
  const pattern = suffix
    ? new RegExp(`^/api/runs/([^/]+)/${suffix}$`)
    : /^\/api\/runs\/([^/]+)$/
  return pathname.match(pattern)?.[1] ?? null
}

export const createDashboardApp = ({ executor = new LocalSafeExecutor(), store } = {}) => {
  const runStore = store ?? new RunStore({ executor })

  return {
    store: runStore,
    async fetch(request) {
      try {
        const url = new URL(request.url)
        if (request.method === 'GET' && url.pathname === '/') {
          return new Response(dashboardHtml, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          })
        }
        if (request.method === 'GET' && url.pathname === '/api/config') {
          return json({
            platforms: ALLOWED_PLATFORMS,
            throttles: THROTTLE_PRESETS,
            ethicsNotice: ETHICS_NOTICE,
            retention: { ...RUN_RETENTION, persistence: 'process-memory-only' },
            executor: { name: 'local-safe', externalCollectionPerformed: false },
          })
        }
        if (request.method === 'POST' && url.pathname === '/api/runs') {
          return json(runStore.create(validateRunInput(await parseJson(request))), 201)
        }

        const runId = routeId(url.pathname)
        if (request.method === 'GET' && runId) return json(runStore.get(runId))

        const approveId = routeId(url.pathname, 'approve')
        if (request.method === 'POST' && approveId) {
          validateApprovalInput(await parseJson(request))
          return json(runStore.approve(approveId), 202)
        }

        const cancelId = routeId(url.pathname, 'cancel')
        if (request.method === 'POST' && cancelId) return json(runStore.cancel(cancelId))

        const reportId = routeId(url.pathname, 'report')
        if (request.method === 'GET' && reportId) {
          return json(runStore.getReport(reportId), 200, {
            'content-type': 'application/json; charset=utf-8',
          })
        }

        const downloadId = routeId(url.pathname, 'download')
        if (request.method === 'GET' && downloadId) {
          return reportDownload(runStore.getReport(downloadId))
        }

        const eventsId = routeId(url.pathname, 'events')
        if (request.method === 'GET' && eventsId) {
          const encoder = new TextEncoder()
          let unsubscribe = () => {}
          const stream = new ReadableStream({
            start(controller) {
              let closed = false
              const send = (event) => {
                if (closed) return
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
                if (['completed', 'canceled', 'failed'].includes(event.state)) {
                  closed = true
                  unsubscribe()
                  controller.close()
                }
              }
              for (const event of runStore.listEvents(eventsId)) {
                send(event)
                if (closed) return
              }
              unsubscribe = runStore.subscribe(eventsId, send)
            },
            cancel() {
              unsubscribe()
            },
          })
          return new Response(stream, {
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache, no-store',
              connection: 'keep-alive',
            },
          })
        }

        return json({ error: 'Not found.' }, 404)
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500
        const message = status === 500 ? 'Internal server error.' : error.message
        return json({ error: message }, status)
      }
    },
  }
}
