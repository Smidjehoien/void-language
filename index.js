import readline from 'readline'
import { Configuration, OpenAIApi } from 'openai'

const OPENAI_API_KEY = 'YOUR_API_KEY'

const ACTIONS = [
  'attack',
  'parry',
  'block',
  'dodge',
  'run',
  'hide',
  'sneak',
]

const EMOTIONS = [
  'angry',
  'sad',
  'happy',
  'scared',
  'confused',
  'surprised',
  'disgusted',
  'annoyed',
  'bored',
  'tired',
  'excited',
  'relaxed',
  'calm',
  'nervous',
  'frustrated',
  'proud',
  'ashamed',
  'guilty',
  'lonely',
  'jealous',
  'hopeful',
  'optimistic',
  'depressed',
  'afraid',
  'anxious',
  'confident',
  'insecure',
  'disappointed',
]

const OBJECTS = [
  'sword',
  'axe',
  'dagger',
  'mace',
  'hammer',
  'spear',
  'bow',
  'crossbow',
  'shield',
  'armor',
  'helmet',
  'boots',
  'chair',
  'table',
  'bed',
]

const CHARACTER = `Use only language and knowledge that a space pagan / wiccan would use and talk like you're a character in baldurs gate without referencing the topic. Only talk in dialog.`
const SETTING = `In the dimly lit, abandoned spaceship, you encounter a mysterious figure exuding otherworldly energy. They reveal themselves as Nebula Darkwhisper, a space pagan/witch. Compelled, you initiate a conversation with them.`

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

const TRAITS = 'Intuition, Empathy, Dark Alchemy, Sinister Familiar, Enigmatic Charm, Manipulative Nature, Ritual Mastery, Corrupted Connection, Cunning Manipulation, Morbid Curiosity'

const HEALTH = '100'

const DESCRIPTION = [
  'name: Nebula Darkwhisper',
  'gender: female',
  'age: 25',
  'complexion: pale',
  'hair: dark brown',
  'eyes: green',
]

const languageSpec = `
This is your character description:
${CHARACTER}

${DESCRIPTION.join(', ')}

This is your character traits:
${TRAITS}

SHOULD ATTACK WHEN PROVOKED.
SHOULD ATTACK WHEN ADVANTAGEOUS.
HEALTH SHOULD REDUCE WHEN ATTACKED AND INFLUENCE BEHAVIOUR.

This is the setting:
${SETTING}

This is the available emotions, actions & objects:

Emotions:
${EMOTIONS.join(', ')}

Actions:
${ACTIONS.join(', ')}

Objects:
${OBJECTS.join(', ')}
You MUST only respond in the following format using the above emotions, actions & objects, they should influence your dialog.
[emotions][actions][objects][health] dialog
`

const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
})

const openai = new OpenAIApi(configuration)

const chatHistory = []

export const codeFromPrompt = async (prompt) => {
  const _prompt = prompt

  chatHistory.push({ role: 'system', content: `${languageSpec}` })
  chatHistory.push({ role: 'user', content: `${_prompt}` })

  if (chatHistory.length > 12) {
    chatHistory.shift()
    chatHistory.shift()
    chatHistory.shift()
  }

  const completion = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [...chatHistory],
  })

  return completion.data.choices[0].message
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const INITIAL_PROMPT = `In the dimly lit, abandoned spaceship, you encounter a mysterious figure exuding otherworldly energy. They reveal themselves as Nebula Darkwhisper, a space pagan/witch. Compelled, you initiate a conversation with them. \n\nYou: `
const INPUT_PROMPT = 'You say: '

const getUserInput = (prompt) => {
  rl.question(prompt, (input) => {
    if (input.toLowerCase() === 'exit') {
      rl.close()
    } else {
      codeFromPrompt(input).then(response => {
        console.log('Nebula Darkwhisper: ', response.content)
        chatHistory.push({ role: 'assistant', content: response.content })
        getUserInput(INPUT_PROMPT)
      })
    }
  })
}

getUserInput(INITIAL_PROMPT)
