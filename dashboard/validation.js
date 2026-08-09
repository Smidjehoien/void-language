import { ALLOWED_PLATFORMS, THROTTLE_PRESETS } from './config.js'

const MAX_HANDLE_LENGTH = 80

export class InputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InputError'
    this.status = 400
  }
}

const expectPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Request body must be a JSON object.')
  }
}

const validateHandles = (handles, maxHandles) => {
  if (!Array.isArray(handles)) {
    throw new InputError('handles must be an array of strings.')
  }
  if (handles.length < 1 || handles.length > maxHandles) {
    throw new InputError(`handles must contain between 1 and ${maxHandles} entries.`)
  }

  const normalized = handles.map((handle) => {
    if (typeof handle !== 'string') {
      throw new InputError('Each handle must be a string.')
    }
    const value = handle.trim()
    if (!value || value.length > MAX_HANDLE_LENGTH) {
      throw new InputError(`Each handle must be between 1 and ${MAX_HANDLE_LENGTH} characters.`)
    }
    if (!/^[\p{L}\p{N}@._-]+$/u.test(value) || value.includes('://')) {
      throw new InputError('Each handle must use handle characters only; URLs are not accepted.')
    }
    return value
  })

  const keys = normalized.map((handle) => handle.toLocaleLowerCase('en-US'))
  if (new Set(keys).size !== keys.length) {
    throw new InputError('Duplicate handles are not allowed.')
  }
  return normalized
}

const validatePlatforms = (platforms, maxPlatforms) => {
  if (!Array.isArray(platforms)) {
    throw new InputError('platforms must be an array of configured platform names.')
  }
  if (platforms.length < 1 || platforms.length > maxPlatforms) {
    throw new InputError(`platforms must contain between 1 and ${maxPlatforms} entries.`)
  }
  if (platforms.some((platform) => typeof platform !== 'string')) {
    throw new InputError('Each platform must be a configured platform name.')
  }
  if (new Set(platforms).size !== platforms.length) {
    throw new InputError('Duplicate platforms are not allowed.')
  }
  if (platforms.some((platform) => !ALLOWED_PLATFORMS.includes(platform))) {
    throw new InputError('One or more platforms are unsupported.')
  }
  return [...platforms]
}

export const validateRunInput = (body) => {
  expectPlainObject(body)
  if (typeof body.throttle !== 'string' || !(body.throttle in THROTTLE_PRESETS)) {
    throw new InputError('throttle must be one of: Safe, Balanced, Fast.')
  }

  const preset = THROTTLE_PRESETS[body.throttle]
  return {
    handles: validateHandles(body.handles, preset.maxHandles),
    platforms: validatePlatforms(body.platforms, preset.maxPlatforms),
    throttle: body.throttle,
  }
}

export const validateApprovalInput = (body) => {
  expectPlainObject(body)
  if (body.approved !== true || body.ethicsAccepted !== true) {
    throw new InputError('Approval and ethics acknowledgement are required.')
  }
  return { approved: true, ethicsAccepted: true }
}
