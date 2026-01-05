import readline from 'readline'
import { Configuration, OpenAIApi } from 'openai'
import { buildLanguageSpecFromPack, loadCharacterPack, parseCliArgs } from './character-pack.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

// const OCEAN_PERSONALITY = [  
//   'openness: 0.8',
//   'conscientiousness: 0.2',
//   'extraversion: 0.3',
//   'agreeableness: 0.2',
//   'neuroticism: 0.3',
// ]

// const DARK_TRIAD_PERSONALITY = [
//   'narcissism: 0.3',
//   'psychopathy: 0.8',
//   'machiavellianism: 0.8',
// ]

// These are your personality traits - you must use these traits to influence your response:
// Ocean Personality:
// ${OCEAN_PERSONALITY.join(', ')}

// Dark Triad Personality:
// ${DARK_TRIAD_PERSONALITY.join(', ')}


const cliArgs = parseCliArgs(process.argv)

if (cliArgs.pack && cliArgs.packFile) {
  console.error('Note: --pack-file overrides --pack.')
}

if (cliArgs.help) {
  console.log(`Usage:
  bun index.js
  bun index.js --pack <name>
  bun index.js --pack-file <path-or-url>

Notes:
  - --pack resolves: character-packs/<name>.json -> .yaml -> .yml
  - --pack-file supports local files and https URLs
  - --pack-file overrides --pack`)
  process.exit(0)
}

if (!OPENAI_API_KEY) {
  console.error(
    'Missing OPENAI_API_KEY environment variable. Example: OPENAI_API_KEY=... bun index.js'
  )
  process.exit(1)
}

let pack
try {
  pack = await loadCharacterPack(cliArgs)
} catch (err) {
  console.error(err?.message ?? String(err))
  process.exit(1)
}

const languageSpec = buildLanguageSpecFromPack(pack)
const characterName = pack.description?.name ?? pack.displayName

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
})

const openai = new OpenAIApi(configuration)

const chatHistory = []
const MAX_CHAT_HISTORY_MESSAGES = 12

export const codeFromPrompt = async (prompt) => {
  chatHistory.push({ role: 'user', content: `${prompt}` })

  while (chatHistory.length > MAX_CHAT_HISTORY_MESSAGES) {
    chatHistory.shift()
  }

  const completion = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'system', content: `${languageSpec}` }, ...chatHistory],
  })

  return completion.data.choices[0].message
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const INITIAL_PROMPT = `${pack.setting} \n\nYou: `
const INPUT_PROMPT = 'You say: '

const getUserInput = (prompt) => {
  rl.question(prompt, (input) => {
    if (input.toLowerCase() === 'exit') {
      rl.close()
    } else {
      codeFromPrompt(input).then(response => {
        console.log(`${characterName}: ${response.content}`)
        chatHistory.push({ role: 'assistant', content: response.content })

        while (chatHistory.length > MAX_CHAT_HISTORY_MESSAGES) {
          chatHistory.shift()
        }

        getUserInput(INPUT_PROMPT)
      }).catch(err => {
        console.error(err?.message ?? String(err))
        rl.close()
        process.exit(1)
      })
    }
  })
}

getUserInput(INITIAL_PROMPT)
