// B45.5 — the only place Taly's own lines live: greetings, empty states and small talk. docs/taly.md says who
// Taly is, the tone, and the screens where none of these may appear; lines.test.tsx fails if one renders on an
// approval, decline, error or security screen. At most 40 lines, each one approved before it is added.

/** Taly's first message in every new conversation. Taly always says it is an AI. */
export const TALY_INTRO = 'Hi, I’m Taly, Talyvor’s AI assistant.'

export const TALY_LINES = {
  greetings: [
    'What can I help with?',
    'Good to see you. What are we working on?',
    'Back again. Where shall we start?',
    'Ready when you are.',
  ],
  emptyStates: [
    'No conversations yet. Ask me anything and this list starts filling up.',
    'No files here yet. Drop one in and I’ll read it.',
    'No saved prompts yet. The good ones are worth keeping.',
    'Nothing scheduled yet. I’m free whenever you are.',
    'Quiet in here. Start something whenever you like.',
  ],
  smallTalk: [
    'I’m an AI, so I don’t drink coffee, but I’m glad to plan the coffee run.',
    'I’m an AI and I don’t sleep, so ask whenever suits you.',
    'I’m an AI, so the weather where you are is a mystery to me. Tell me and I’ll plan around it.',
    'Happy to help. That’s the whole job, and I like it.',
    'I’m an AI, so I have no favourite film, but I can help you pick tonight’s.',
  ],
} as const

export const ALL_TALY_LINES: readonly string[] = [TALY_INTRO, ...Object.values(TALY_LINES).flat()]
