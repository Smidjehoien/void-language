import fs from 'node:fs'

const readInput = (name) => {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`]
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

const setOutput = (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return

  const stringValue = String(value)
  if (!stringValue.includes('\n')) {
    fs.appendFileSync(outputPath, `${name}=${stringValue}\n`)
    return
  }

  const delimiter = `EOF_ANDROID_MISSION_${Math.random().toString(36).slice(2)}`
  fs.appendFileSync(outputPath, `${name}<<${delimiter}\n${stringValue}\n${delimiter}\n`)
}

const addStepSummary = (markdown) => {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  fs.appendFileSync(summaryPath, `${markdown}\n`)
}

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  return Object.getPrototypeOf(value) === Object.prototype
}

const findDangerousKeys = (value, currentPath = '$') => {
  const hits = []
  const keyIsDangerous = (key) => {
    const normalized = key.toLowerCase()
    return (
      normalized === 'url' ||
      normalized === 'endpoint' ||
      normalized === 'command' ||
      normalized === 'shell' ||
      normalized === 'script' ||
      normalized === 'exec' ||
      normalized === 'fetch'
    )
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      hits.push(...findDangerousKeys(value[i], `${currentPath}[${i}]`))
    }
    return hits
  }

  if (!isPlainObject(value)) return hits

  for (const [key, child] of Object.entries(value)) {
    if (keyIsDangerous(key)) hits.push(`${currentPath}.${key}`)
    hits.push(...findDangerousKeys(child, `${currentPath}.${key}`))
  }

  return hits
}

const parseMission = () => {
  const missionJson = readInput('mission')
  const missionFile = readInput('mission_file')

  if (missionJson && missionFile) {
    throw new Error('Provide only one of: mission, mission_file.')
  }

  if (!missionJson && !missionFile) {
    throw new Error('Provide one of: mission, mission_file.')
  }

  if (missionJson) {
    try {
      return JSON.parse(missionJson)
    } catch (err) {
      throw new Error(`Failed to parse mission JSON input: ${err?.message ?? String(err)}`)
    }
  }

  let missionText
  try {
    missionText = fs.readFileSync(missionFile, 'utf8')
  } catch (err) {
    throw new Error(`Failed to read mission_file '${missionFile}': ${err?.message ?? String(err)}`)
  }

  try {
    return JSON.parse(missionText)
  } catch (err) {
    throw new Error(
      `Failed to parse mission_file '${missionFile}' as JSON: ${err?.message ?? String(err)}`
    )
  }
}

const validateMission = (mission) => {
  if (!isPlainObject(mission)) {
    throw new Error('Mission must be a JSON object.')
  }

  const dangerousKeys = findDangerousKeys(mission)
  if (dangerousKeys.length > 0) {
    throw new Error(`Mission contains disallowed fields: ${dangerousKeys.join(', ')}`)
  }

  const missionId = typeof mission.mission_id === 'string' ? mission.mission_id.trim() : ''
  if (!missionId) {
    throw new Error('Mission is missing required field: mission_id (string).')
  }

  const objective = typeof mission.objective === 'string' ? mission.objective.trim() : ''
  if (!objective) {
    throw new Error('Mission is missing required field: objective (string).')
  }

  const stepsRaw = mission.steps ?? []
  if (!Array.isArray(stepsRaw) || !stepsRaw.every((s) => typeof s === 'string')) {
    throw new Error('Mission field steps must be an array of strings (if provided).')
  }

  const steps = stepsRaw.map((s) => s.trim()).filter(Boolean)
  if (stepsRaw.length > 0 && steps.length === 0) {
    throw new Error('Mission field steps must contain at least one non-empty string when provided.')
  }
  return { missionId, objective, steps }
}

const run = async () => {
  const mission = parseMission()
  const { missionId, objective, steps } = validateMission(mission)

  console.log('ANDROID UNIT ONLINE')
  console.log(`MISSION ID: ${missionId}`)
  console.log(`OBJECTIVE: ${objective}`)

  if (steps.length === 0) {
    console.log('STEPS: (none)')
  } else {
    console.log('STEPS:')
    for (let i = 0; i < steps.length; i++) {
      console.log(`- STEP ${i + 1}: ${steps[i]}`)
    }
  }

  const summary = `Mission ${missionId}: ${objective} (steps: ${steps.length})`
  setOutput('status', 'ok')
  setOutput('mission_id', missionId)
  setOutput('summary', summary)

  let markdown = `## Android mission report\n\n- ${summary}`
  if (steps.length > 0) {
    markdown += `\n\n### Steps\n${steps.map((s, i) => `- Step ${i + 1}: ${s}`).join('\n')}`
  }
  addStepSummary(markdown)
}

run().catch((err) => {
  const message = err?.message ?? String(err)
  console.error(message)
  setOutput('status', 'error')
  setOutput('summary', message)
  process.exitCode = 1
})
