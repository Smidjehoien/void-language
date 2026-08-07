import { describe, expect, test } from 'bun:test'
import { LocalSafeExecutor } from '../dashboard/executor.js'
import { RunStore } from '../dashboard/run-store.js'

const waitForState = async (store, id, target) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = store.get(id)
    if (run.state === target) return run
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${target}`)
}

describe('run lifecycle', () => {
  test('requires approval, runs, and emits only allowlist-shaped data', async () => {
    const secret = 'private-person@example.test</script>'
    const store = new RunStore({ executor: new LocalSafeExecutor() })
    const created = store.create({ handles: [secret], platforms: ['bluesky'], throttle: 'Fast' })

    expect(created.state).toBe('pending_approval')
    expect(JSON.stringify(created)).not.toContain(secret)

    const approved = store.approve(created.id)
    expect(approved.state).toBe('running')
    const completed = await waitForState(store, created.id, 'completed')
    const report = store.getReport(created.id)
    const allPublicData = JSON.stringify({ completed, events: store.listEvents(created.id), report })

    expect(report.aggregates.handleCount).toBe(1)
    expect(report.execution.externalCollectionPerformed).toBe(false)
    expect(report.aggregates.providerRecordsCollected).toBe(0)
    expect(allPublicData).not.toContain(secret)
    expect(allPublicData).not.toContain('private-person')
    expect(store.runs.get(created.id).handles).toBeNull()
  })

  test('cancels pending and running runs and clears execution input', async () => {
    const store = new RunStore({ executor: new LocalSafeExecutor() })
    const pending = store.create({ handles: ['pending-secret'], platforms: ['reddit'], throttle: 'Safe' })
    expect(store.cancel(pending.id).state).toBe('canceled')
    expect(JSON.stringify(store.listEvents(pending.id))).not.toContain('pending-secret')
    expect(store.runs.get(pending.id).handles).toBeNull()

    const running = store.create({ handles: ['running-secret'], platforms: ['reddit'], throttle: 'Safe' })
    store.approve(running.id)
    expect(store.cancel(running.id).state).toBe('canceled')
    await Bun.sleep(20)
    expect(store.get(running.id).state).toBe('canceled')
    expect(JSON.stringify(store.listEvents(running.id))).not.toContain('running-secret')
    expect(store.runs.get(running.id).handles).toBeNull()
  })

  test('ignores executor progress after cancellation and emits one terminal event', async () => {
    let emitAfterCancel
    const executor = {
      async execute({ emit }) {
        emit({ kind: 'started' })
        await new Promise((resolve) => {
          emitAfterCancel = () => {
            emit({ kind: 'finalizing' })
            emit({ kind: 'platform-checked', platform: 'reddit', completedPlatforms: 1 })
            resolve()
          }
        })
      },
    }
    const store = new RunStore({ executor })
    const run = store.create({ handles: ['secret'], platforms: ['reddit'], throttle: 'Fast' })
    store.approve(run.id)
    expect(store.cancel(run.id).state).toBe('canceled')

    const eventsAtCancellation = store.listEvents(run.id)
    emitAfterCancel()
    await Bun.sleep(0)
    const eventsAfterExecutorSettles = store.listEvents(run.id)

    expect(eventsAfterExecutorSettles).toEqual(eventsAtCancellation)
    expect(eventsAfterExecutorSettles.filter((event) => event.phase === 'terminal')).toHaveLength(1)
    expect(eventsAfterExecutorSettles.at(-1).state).toBe('canceled')
  })

  test('bounds events and terminal run retention', async () => {
    const executor = {
      async execute({ emit }) {
        for (let index = 0; index < 10; index++) emit({ kind: 'started' })
        return {
          externalCollectionPerformed: false,
          providerRecordsCollected: 0,
        }
      },
    }
    const store = new RunStore({ executor, maxRuns: 2, maxEvents: 4 })
    const first = store.create({ handles: ['one'], platforms: ['bluesky'], throttle: 'Fast' })
    store.approve(first.id)
    await waitForState(store, first.id, 'completed')
    expect(store.listEvents(first.id).length).toBe(4)

    store.create({ handles: ['two'], platforms: ['bluesky'], throttle: 'Fast' })
    store.create({ handles: ['three'], platforms: ['bluesky'], throttle: 'Fast' })
    expect(() => store.get(first.id)).toThrow('Run not found')
  })

  test('does not trust executor-provided event or report display fields', async () => {
    const secret = 'executor-must-not-leak-this-handle'
    const executor = {
      async execute({ emit }) {
        emit({
          kind: 'platform-checked',
          platform: secret,
          message: secret,
          state: secret,
          nested: { secret },
        })
        return {
          providerRecordsCollected: 3,
          externalCollectionPerformed: false,
          summary: secret,
          platforms: [secret],
        }
      },
    }
    const store = new RunStore({ executor })
    const run = store.create({ handles: [secret], platforms: ['bluesky'], throttle: 'Fast' })
    store.approve(run.id)
    await waitForState(store, run.id, 'completed')

    expect(JSON.stringify({ events: store.listEvents(run.id), report: store.getReport(run.id) })).not.toContain(secret)
    expect(store.getReport(run.id).aggregates.providerRecordsCollected).toBe(0)
    expect(store.getReport(run.id).execution.externalCollectionPerformed).toBe(false)
  })

  test('expires unapproved runs and clears their handles', async () => {
    const store = new RunStore({ executor: new LocalSafeExecutor(), approvalTtlMs: 5 })
    const run = store.create({ handles: ['expiring-secret'], platforms: ['bluesky'], throttle: 'Fast' })
    await waitForState(store, run.id, 'canceled')
    expect(store.runs.get(run.id).handles).toBeNull()
    expect(JSON.stringify(store.listEvents(run.id))).not.toContain('expiring-secret')
  })
})
