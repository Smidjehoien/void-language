import { randomUUID } from 'node:crypto'
import { RUN_RETENTION, THROTTLE_PRESETS } from './config.js'

const TERMINAL_STATES = new Set(['completed', 'canceled', 'failed'])
const publicEvent = (event) => ({
  sequence: event.sequence,
  type: event.type,
  state: event.state,
  phase: event.phase,
  message: event.message,
  platform: event.platform,
  completedPlatforms: event.completedPlatforms,
  totalPlatforms: event.totalPlatforms,
  timestamp: event.timestamp,
})

const publicRun = (run) => ({
  id: run.id,
  state: run.state,
  handleCount: run.handleCount,
  platforms: [...run.platforms],
  throttle: run.throttle,
  approvalRequired: run.state === 'pending_approval',
  createdAt: run.createdAt,
  approvedAt: run.approvedAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  reportAvailable: run.state === 'completed',
})

export class RunStore {
  constructor({
    executor,
    maxRuns = RUN_RETENTION.maxRuns,
    maxEvents = RUN_RETENTION.maxEventsPerRun,
    approvalTtlMs = RUN_RETENTION.approvalTtlMs,
  } = {}) {
    this.executor = executor
    this.maxRuns = maxRuns
    this.maxEvents = maxEvents
    this.approvalTtlMs = approvalTtlMs
    this.runs = new Map()
  }

  create(input) {
    this.#prune()
    const now = new Date().toISOString()
    const run = {
      id: randomUUID(),
      state: 'pending_approval',
      handleCount: input.handles.length,
      handles: [...input.handles],
      platforms: [...input.platforms],
      throttle: input.throttle,
      createdAt: now,
      approvedAt: null,
      startedAt: null,
      finishedAt: null,
      report: null,
      events: [],
      terminalEventEmitted: false,
      subscribers: new Set(),
      abortController: null,
      approvalTimer: null,
    }
    this.runs.set(run.id, run)
    run.approvalTimer = setTimeout(() => {
      if (run.state === 'pending_approval') {
        this.#finish(run, 'canceled', 'Run approval expired. Execution inputs were cleared.')
      }
    }, this.approvalTtlMs)
    run.approvalTimer.unref?.()
    this.#emit(run, {
      type: 'state',
      state: run.state,
      phase: 'approval',
      message: 'Run created and awaiting explicit human approval.',
    })
    return publicRun(run)
  }

  get(id) {
    const run = this.#require(id)
    return publicRun(run)
  }

  listEvents(id) {
    return this.#require(id).events.map(publicEvent)
  }

  subscribe(id, listener) {
    const run = this.#require(id)
    run.subscribers.add(listener)
    return () => run.subscribers.delete(listener)
  }

  approve(id) {
    const run = this.#require(id)
    if (run.state !== 'pending_approval') {
      throw this.#conflict('Only pending runs can be approved.')
    }
    run.approvedAt = new Date().toISOString()
    clearTimeout(run.approvalTimer)
    run.approvalTimer = null
    void this.#execute(run)
    return publicRun(run)
  }

  cancel(id) {
    const run = this.#require(id)
    if (TERMINAL_STATES.has(run.state)) {
      throw this.#conflict('Terminal runs cannot be canceled.')
    }
    run.abortController?.abort()
    this.#finish(run, 'canceled', 'Run canceled. Execution inputs were cleared.')
    return publicRun(run)
  }

  getReport(id) {
    const run = this.#require(id)
    if (run.state !== 'completed' || !run.report) {
      throw this.#conflict('Report is available only after completion.')
    }
    return structuredClone(run.report)
  }

  async #execute(run) {
    run.state = 'running'
    run.startedAt = new Date().toISOString()
    run.abortController = new AbortController()
    this.#emit(run, {
      type: 'state',
      state: run.state,
      phase: 'execution',
      message: 'Approved run started.',
    })

    try {
      await this.executor.execute({
        handles: run.handles,
        platforms: run.platforms,
        throttle: run.throttle,
        preset: THROTTLE_PRESETS[run.throttle],
        signal: run.abortController.signal,
        emit: (event) => this.#emitExecutorProgress(run, event),
      })
      if (run.state === 'canceled') return

      run.report = {
        runId: run.id,
        generatedAt: new Date().toISOString(),
        status: 'completed',
        aggregates: {
          handleCount: run.handleCount,
          platformCount: run.platforms.length,
          platforms: [...run.platforms],
          providerRecordsCollected: 0,
        },
        execution: {
          throttle: run.throttle,
          externalCollectionPerformed: false,
          executor: 'local-safe',
        },
        summary:
          'No external collection was performed. This deterministic local executor validates workflow behavior only.',
      }
      this.#finish(run, 'completed', 'Run completed with a sanitized aggregate report.')
    } catch (error) {
      if (error?.name === 'AbortError' || run.state === 'canceled') return
      this.#finish(run, 'failed', 'Run failed without exposing execution inputs.')
    }
  }

  #finish(run, state, message) {
    if (TERMINAL_STATES.has(run.state)) return
    run.state = state
    run.finishedAt = new Date().toISOString()
    clearTimeout(run.approvalTimer)
    run.approvalTimer = null
    run.handles = null
    run.abortController = null
    this.#emit(run, { type: 'state', state, phase: 'terminal', message })
  }

  #emitExecutorProgress(run, event) {
    if (!event || typeof event !== 'object') return
    if (event.kind === 'started') {
      this.#emit(run, {
        type: 'progress',
        state: run.state,
        phase: 'starting',
        message: 'Local safe executor started.',
      })
      return
    }
    if (event.kind === 'finalizing') {
      this.#emit(run, {
        type: 'progress',
        state: run.state,
        phase: 'finalizing',
        message: 'Aggregate report prepared.',
      })
      return
    }
    if (event.kind === 'platform-checked' && run.platforms.includes(event.platform)) {
      this.#emit(run, {
        type: 'progress',
        state: run.state,
        phase: 'platform-check',
        message: 'Configured platform boundary checked.',
        platform: event.platform,
        completedPlatforms: Number.isSafeInteger(event.completedPlatforms)
          ? Math.min(Math.max(event.completedPlatforms, 0), run.platforms.length)
          : undefined,
        totalPlatforms: run.platforms.length,
      })
    }
  }

  #emit(run, event) {
    if (run.terminalEventEmitted) return false

    const isTerminalEvent = event.type === 'state' && TERMINAL_STATES.has(event.state)
    const safeEvent = {
      sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
      type: event.type,
      state: event.state,
      phase: event.phase,
      message: event.message,
      platform: event.platform,
      completedPlatforms: event.completedPlatforms,
      totalPlatforms: event.totalPlatforms,
      timestamp: new Date().toISOString(),
    }
    run.events.push(safeEvent)
    if (isTerminalEvent) run.terminalEventEmitted = true
    if (run.events.length > this.maxEvents) run.events.shift()
    for (const listener of run.subscribers) listener(publicEvent(safeEvent))
    return true
  }

  #require(id) {
    const run = this.runs.get(id)
    if (!run) {
      const error = new Error('Run not found.')
      error.status = 404
      throw error
    }
    return run
  }

  #conflict(message) {
    const error = new Error(message)
    error.status = 409
    return error
  }

  #prune() {
    if (this.runs.size < this.maxRuns) return
    const removable = [...this.runs.values()].find((run) => TERMINAL_STATES.has(run.state))
    if (removable) this.runs.delete(removable.id)
    if (this.runs.size >= this.maxRuns) {
      const error = new Error('Run capacity reached; wait for an active run to finish.')
      error.status = 503
      throw error
    }
  }
}
