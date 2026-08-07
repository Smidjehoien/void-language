import { ALLOWED_PLATFORMS, ETHICS_NOTICE, THROTTLE_PRESETS } from './config.js'

export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Void local run dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #11131a; color: #f4f4f5; }
    body { max-width: 880px; margin: 0 auto; padding: 2rem 1rem 4rem; }
    section { background: #1b1f2a; border: 1px solid #333948; border-radius: 12px; padding: 1rem; margin: 1rem 0; }
    label { display: block; margin: .75rem 0; } input, select, button { font: inherit; }
    textarea { width: 100%; min-height: 7rem; box-sizing: border-box; }
    button, .button { display: inline-block; padding: .6rem .9rem; margin-right: .4rem; cursor: pointer; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0d0f14; padding: 1rem; border-radius: 8px; }
    .warning { border-left: 4px solid #e6aa3b; padding-left: .75rem; }
  </style>
</head>
<body>
  <h1>Local run dashboard</h1>
  <p class="warning"><strong>Safe local executor:</strong> this build performs no external collection and does not fabricate provider data. It demonstrates validation, approval, status, cancellation, and sanitized reporting.</p>
  <section>
    <h2>Create run</h2>
    <form id="run-form">
      <label>Handles (one per line)<textarea id="handles" required maxlength="1619"></textarea></label>
      <fieldset><legend>Configured platforms</legend>${ALLOWED_PLATFORMS.map((p) => `<label><input type="checkbox" name="platform" value="${p}"> ${p}</label>`).join('')}</fieldset>
      <label>Throttling <select id="throttle">${Object.keys(THROTTLE_PRESETS).map((p) => `<option>${p}</option>`).join('')}</select></label>
      <button type="submit">Create for approval</button>
    </form>
    <p class="warning">${ETHICS_NOTICE}</p>
  </section>
  <section>
    <h2>Run</h2>
    <div id="actions" hidden>
      <label><input id="ethics" type="checkbox"> I confirm the inputs are authorized and the ethics guardrails will be followed.</label>
      <button id="approve">Approve and start</button><button id="cancel">Cancel</button>
    </div>
    <pre id="status">No run created.</pre>
  </section>
  <section><h2>Sanitized live status</h2><pre id="events">No events.</pre></section>
  <section>
    <h2>Aggregate report</h2>
    <pre id="report">Available on screen after completion.</pre>
    <a class="button" id="download" href="" download hidden>Download JSON report</a>
  </section>
<script type="module">
  let runId = null
  let source = null
  const status = document.querySelector('#status')
  const events = document.querySelector('#events')
  const report = document.querySelector('#report')
  const download = document.querySelector('#download')
  const actions = document.querySelector('#actions')
  const approve = document.querySelector('#approve')

  const request = async (path, options = {}) => {
    const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Request failed')
    return body
  }
  const showRun = (run) => {
    status.textContent = JSON.stringify(run, null, 2)
    actions.hidden = ['completed', 'canceled', 'failed'].includes(run.state)
    approve.hidden = run.state !== 'pending_approval'
    if (!run.reportAvailable) {
      download.hidden = true
      download.removeAttribute('href')
      return
    }
    const reportRunId = run.id
    request('/api/runs/' + reportRunId + '/report').then((data) => {
      if (runId !== reportRunId) return
      report.textContent = JSON.stringify(data, null, 2)
      download.href = '/api/runs/' + reportRunId + '/download'
      download.hidden = false
    })
  }
  const refresh = () => runId && request('/api/runs/' + runId).then(showRun)

  document.querySelector('#run-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const handles = document.querySelector('#handles').value.split(/\n/).map((v) => v.trim()).filter(Boolean)
      const platforms = [...document.querySelectorAll('input[name=platform]:checked')].map((v) => v.value)
      const throttle = document.querySelector('#throttle').value
      const run = await request('/api/runs', { method: 'POST', body: JSON.stringify({ handles, platforms, throttle }) })
      runId = run.id
      source?.close()
      source = new EventSource('/api/runs/' + runId + '/events')
      source.onmessage = (message) => {
        const event = JSON.parse(message.data)
        events.textContent += '\n' + JSON.stringify(event)
        if (['completed', 'canceled', 'failed'].includes(event.state)) source.close()
        refresh()
      }
      events.textContent = ''
      report.textContent = 'Available on screen after completion.'
      download.hidden = true
      download.removeAttribute('href')
      document.querySelector('#handles').value = ''
      document.querySelector('#ethics').checked = false
      showRun(run)
    } catch (error) { status.textContent = error.message }
  })
  approve.addEventListener('click', async () => {
    try {
      showRun(await request('/api/runs/' + runId + '/approve', { method: 'POST', body: JSON.stringify({ approved: true, ethicsAccepted: document.querySelector('#ethics').checked }) }))
    } catch (error) { status.textContent = error.message }
  })
  document.querySelector('#cancel').addEventListener('click', async () => {
    try { showRun(await request('/api/runs/' + runId + '/cancel', { method: 'POST', body: '{}' })) }
    catch (error) { status.textContent = error.message }
  })
</script>
</body></html>`
