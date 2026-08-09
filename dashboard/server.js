import { createDashboardApp } from './app.js'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])

export const resolveServerOptions = (argv = process.argv, env = process.env) => {
  const hostArg = argv.find((arg) => arg.startsWith('--host='))
  const portArg = argv.find((arg) => arg.startsWith('--port='))
  const hostname = hostArg?.slice('--host='.length) || env.DASHBOARD_HOST || '127.0.0.1'
  const portValue = portArg?.slice('--port='.length) || env.DASHBOARD_PORT || '3000'
  const port = Number(portValue)
  const allowNonLoopback = argv.includes('--allow-non-loopback') || env.DASHBOARD_ALLOW_NON_LOOPBACK === '1'

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Dashboard port must be an integer between 0 and 65535.')
  }
  if (!LOOPBACK_HOSTS.has(hostname) && !allowNonLoopback) {
    throw new Error('Non-loopback dashboard binding requires --allow-non-loopback or DASHBOARD_ALLOW_NON_LOOPBACK=1.')
  }
  return { hostname, port }
}

export const startDashboardServer = (options = resolveServerOptions()) => {
  const app = createDashboardApp()
  return Bun.serve({ ...options, fetch: app.fetch })
}

if (import.meta.main) {
  try {
    const server = startDashboardServer()
    console.log(`Void dashboard listening on http://${server.hostname}:${server.port}`)
    console.log('Local safe executor enabled: no external collection is performed.')
  } catch (error) {
    console.error(error?.message ?? String(error))
    process.exit(1)
  }
}
