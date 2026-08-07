import { describe, expect, test } from 'bun:test'
import { buildLanguageSpecFromPack, loadCharacterPack, parseCliArgs } from '../character-pack.js'

describe('existing character pack behavior', () => {
  test('parses existing CLI options', () => {
    expect(parseCliArgs(['bun', 'index.js', '--pack', 'nebula-darkwhisper'])).toEqual({
      pack: 'nebula-darkwhisper',
      packFile: null,
      help: false,
    })
  })

  test('loads the default pack and builds its language spec', async () => {
    const pack = await loadCharacterPack({ pack: null, packFile: null })
    expect(pack.id).toBe('nebula-darkwhisper')
    expect(buildLanguageSpecFromPack(pack)).toContain(pack.description.name)
  })
})
