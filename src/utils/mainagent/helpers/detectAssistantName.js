import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const DETECT_NAME_PROMPT = `You are a name extractor.
Extract the AI assistant's own name from the given system prompt.
Return JSON: {"name": "AssistantName"} if the AI is explicitly given a name, or {"name": null} if no name is found.
Only extract a name that is clearly the AI's identity (e.g. "Your name is X", "You are X", "เธอชื่อ X", "ชื่อว่า X", "ชื่อ X").
Do NOT extract human names, user names, or general role descriptions.`

export async function detectAssistantName({ settings, systemPrompt, signal }) {
  const llm = makeLLM(settings, {
    temperature: 0,
    structured: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The AI assistant name, or empty string if not found' } },
      required: ['name'],
    },
  })

  const response = await llm.invoke([
    new SystemMessage(DETECT_NAME_PROMPT),
    new HumanMessage(`System prompt:\n${systemPrompt}`),
  ], { signal })
  return response.name?.trim() || null
}
