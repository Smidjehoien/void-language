import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const MAX_REMOTE_PACK_BYTES = 1024 * 1024
const PACK_EXTENSIONS_IN_RESOLUTION_ORDER = ['.json', '.yaml', '.yml']

const getPackDirPath = () => {
  const currentFilePath = fileURLToPath(import.meta.url)
  return path.join(path.dirname(currentFilePath), 'character-packs')
}

const getHttpUrlProtocol = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.protocol
    }
    return null
  } catch {
    if (typeof value === 'string' && value.includes('://')) {
      throw new Error(`Invalid pack URL: ${value}`)
    }
    return null
  }
}

const parsePackText = ({ text, sourceLabel, fileExtension }) => {
  if (fileExtension === '.json') {
    try {
      return JSON.parse(text)
    } catch (err) {
      throw new Error(
        `Failed to parse JSON pack (${sourceLabel}): ${err?.message ?? String(err)}`
      )
    }
  }

  if (fileExtension === '.yaml' || fileExtension === '.yml') {
    try {
      return YAML.parse(text)
    } catch (err) {
      throw new Error(
        `Failed to parse YAML pack (${sourceLabel}): ${err?.message ?? String(err)}`
      )
    }
  }

  throw new Error(
    `Unsupported pack file extension (${fileExtension}). Supported: ${PACK_EXTENSIONS_IN_RESOLUTION_ORDER.join(
      ', '
    )}.`
  )
}

const expectString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Pack validation failed: ${label} must be a non-empty string.`)
  }
}

const expectNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Pack validation failed: ${label} must be a finite number.`)
  }
}

const expectStringArray = (value, label) => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((v) => typeof v !== 'string' || v.length === 0)
  ) {
    throw new Error(
      `Pack validation failed: ${label} must be a non-empty array of non-empty strings.`
    )
  }
}

const validatePack = (pack) => {
  if (!pack || typeof pack !== 'object') {
    throw new Error('Pack validation failed: pack must be an object.')
  }

  expectString(pack.id, 'id')
  expectString(pack.displayName, 'displayName')
  expectString(pack.character, 'character')
  expectString(pack.setting, 'setting')
  expectStringArray(pack.traits, 'traits')
  expectNumber(pack.health, 'health')
  if (pack.health < 0 || pack.health > 1000) {
    throw new Error('Pack validation failed: health must be between 0 and 1000.')
  }

  if (!pack.description || typeof pack.description !== 'object') {
    throw new Error('Pack validation failed: description must be an object.')
  }

  expectString(pack.description.name, 'description.name')
  expectString(pack.description.gender, 'description.gender')
  expectNumber(pack.description.age, 'description.age')
  expectString(pack.description.complexion, 'description.complexion')
  expectString(pack.description.hair, 'description.hair')
  expectString(pack.description.eyes, 'description.eyes')

  if (!pack.vocab || typeof pack.vocab !== 'object') {
    throw new Error('Pack validation failed: vocab must be an object.')
  }

  expectStringArray(pack.vocab.emotions, 'vocab.emotions')
  expectStringArray(pack.vocab.actions, 'vocab.actions')
  expectStringArray(pack.vocab.objects, 'vocab.objects')

  return pack
}

const validatePackWithSource = (pack, sourceLabel) => {
  try {
    return validatePack(pack)
  } catch (err) {
    throw new Error(`${err?.message ?? String(err)} (source: ${sourceLabel})`)
  }
}

const resolveNamedPackPath = async (packName) => {
  const packDirPath = getPackDirPath()

  for (const ext of PACK_EXTENSIONS_IN_RESOLUTION_ORDER) {
    const candidatePath = path.join(packDirPath, `${packName}${ext}`)
    try {
      await fs.access(candidatePath)
      return { path: candidatePath, fileExtension: ext }
    } catch {
      // continue
    }
  }

  throw new Error(
    `Pack not found: ${packName}. Looked for ${PACK_EXTENSIONS_IN_RESOLUTION_ORDER.map(
      (ext) => `character-packs/${packName}${ext}`
    ).join(', ')}.`
  )
}

const loadPackByName = async (packName) => {
  const { path: resolvedPath, fileExtension } = await resolveNamedPackPath(packName)
  const text = await fs.readFile(resolvedPath, 'utf8')
  const parsed = parsePackText({
    text,
    sourceLabel: resolvedPath,
    fileExtension,
  })
  return validatePackWithSource(parsed, resolvedPath)
}

const getFileExtension = (filePathOrUrl) => {
  const ext = path.extname(filePathOrUrl)
  return ext.toLowerCase()
}

const loadLocalPackByPath = async (packFilePath) => {
  const resolvedPath = path.resolve(process.cwd(), packFilePath)
  const fileExtension = getFileExtension(resolvedPath)

  if (!PACK_EXTENSIONS_IN_RESOLUTION_ORDER.includes(fileExtension)) {
    throw new Error(
      `Unsupported pack file extension (${fileExtension}). Supported: ${PACK_EXTENSIONS_IN_RESOLUTION_ORDER.join(
        ', '
      )}.`
    )
  }

  let text
  try {
    text = await fs.readFile(resolvedPath, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Pack file not found: ${resolvedPath}`)
    }
    throw err
  }
  const pack = parsePackText({
    text,
    sourceLabel: resolvedPath,
    fileExtension,
  })

  return validatePackWithSource(pack, resolvedPath)
}

const readResponseBodyWithLimit = async ({ response, sourceLabel, maxBytes }) => {
  const reader = response.body?.getReader?.()

  if (!reader) {
    let data
    try {
      data = new Uint8Array(await response.arrayBuffer())
    } catch (err) {
      throw new Error(`Failed to read pack response body from ${sourceLabel}.`)
    }
    if (data.byteLength > maxBytes) {
      throw new Error(
        `Remote pack is too large (${data.byteLength} bytes). Max allowed: ${maxBytes} bytes.`
      )
    }
    return data
  }

  const chunks = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }

      throw new Error(
        `Remote pack is too large (${totalBytes} bytes). Max allowed: ${maxBytes} bytes.`
      )
    }

    chunks.push(value)
  }

  const data = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }

  return data
}

const loadRemotePackByUrl = async (packFileUrl) => {
  const url = new URL(packFileUrl)
  if (url.protocol !== 'https:') {
    throw new Error('Remote pack URLs must use HTTPS.')
  }

  const fileExtension = getFileExtension(url.pathname)

  if (!PACK_EXTENSIONS_IN_RESOLUTION_ORDER.includes(fileExtension)) {
    throw new Error(
      `Unsupported pack file extension (${fileExtension}). Supported: ${PACK_EXTENSIONS_IN_RESOLUTION_ORDER.join(
        ', '
      )}.`
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  let response
  try {
    response = await fetch(packFileUrl, { signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Timed out fetching pack from ${packFileUrl}.`)
    }
    throw new Error(`Failed to fetch pack from ${packFileUrl}: ${err?.message ?? String(err)}`)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch pack from ${packFileUrl} (${response.status} ${response.statusText}).`
    )
  }

  const contentLength = response.headers.get('content-length')
  const contentLengthNumber = Number(contentLength)
  if (Number.isFinite(contentLengthNumber) && contentLengthNumber > MAX_REMOTE_PACK_BYTES) {
    throw new Error(
      `Remote pack is too large (${contentLengthNumber} bytes). Max allowed: ${MAX_REMOTE_PACK_BYTES} bytes.`
    )
  }

  const data = await readResponseBodyWithLimit({
    response,
    sourceLabel: packFileUrl,
    maxBytes: MAX_REMOTE_PACK_BYTES,
  })

  const text = new TextDecoder().decode(data)
  const pack = parsePackText({
    text,
    sourceLabel: packFileUrl,
    fileExtension,
  })

  return validatePackWithSource(pack, packFileUrl)
}

export const parseCliArgs = (argv) => {
  const args = {
    pack: null,
    packFile: null,
    help: false,
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }

    if (arg === '--pack') {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --pack; expected a pack name.')
      }
      args.pack = value
      i++
      continue
    }

    if (arg.startsWith('--pack=')) {
      const value = arg.slice('--pack='.length)
      if (!value) {
        throw new Error('Missing value for --pack; expected a pack name.')
      }
      args.pack = value
      continue
    }

    if (arg === '--pack-file') {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --pack-file; expected a path or URL.')
      }
      args.packFile = value
      i++
      continue
    }

    if (arg.startsWith('--pack-file=')) {
      const value = arg.slice('--pack-file='.length)
      if (!value) {
        throw new Error('Missing value for --pack-file; expected a path or URL.')
      }
      args.packFile = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

export const buildLanguageSpecFromPack = (pack) => {
  const descriptionParts = [
    `name: ${pack.description.name}`,
    `gender: ${pack.description.gender}`,
    `age: ${pack.description.age}`,
    `complexion: ${pack.description.complexion}`,
    `hair: ${pack.description.hair}`,
    `eyes: ${pack.description.eyes}`,
  ]

  return `
This is your character description:
${pack.character}

${descriptionParts.join(', ')}

This is your character traits:
${pack.traits.join(', ')}

SHOULD ATTACK WHEN PROVOKED.
SHOULD ATTACK WHEN ADVANTAGEOUS.
HEALTH SHOULD REDUCE WHEN ATTACKED AND INFLUENCE BEHAVIOUR.

This is the setting:
${pack.setting}

This is the available emotions, actions & objects:

Emotions:
${pack.vocab.emotions.join(', ')}

Actions:
${pack.vocab.actions.join(', ')}

Objects:
${pack.vocab.objects.join(', ')}
You MUST only respond in the following format using the above emotions, actions & objects, they should influence your dialog.
[emotions][actions][objects][health] dialog
`
}

export const loadCharacterPack = async ({ pack, packFile }) => {
  if (packFile) {
    const protocol = getHttpUrlProtocol(packFile)
    if (protocol === 'http:') {
      throw new Error('Remote pack URLs must use HTTPS.')
    }
    if (protocol === 'https:') {
      return loadRemotePackByUrl(packFile)
    }
    return loadLocalPackByPath(packFile)
  }

  if (pack) {
    return loadPackByName(pack)
  }

  return loadPackByName('nebula-darkwhisper')
}
