const wait = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Run canceled', 'AbortError'))
      },
      { once: true }
    )
  })

/**
* Executor adapter contract:
* execute({ handles, platforms, throttle, signal, emit }) => execution result
*
* Handles are execution-only data. Adapters must never include them in emitted
* events, returned results, thrown errors, or logs. Event kinds are interpreted
* by RunStore; executor-provided display messages are never accepted.
*/
export class LocalSafeExecutor {
  async execute({ handles, platforms, throttle, preset, signal, emit }) {
    emit({ kind: 'started' })
    await wait(preset.stepDelayMs, signal)

    for (let index = 0; index < platforms.length; index++) {
      signal.throwIfAborted()
      emit({
        kind: 'platform-checked',
        platform: platforms[index],
        completedPlatforms: index + 1,
        totalPlatforms: platforms.length,
      })
      await wait(preset.stepDelayMs, signal)
    }

    emit({ kind: 'finalizing' })
    await wait(preset.stepDelayMs, signal)

    return {
      externalCollectionPerformed: false,
      providerRecordsCollected: 0,
    }
  }
}
