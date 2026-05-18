import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const DETECT_NAME_PROMPT = `[บทบาท]
ดึงชื่อของ AI assistant จาก system prompt ที่ได้รับ
ตอบเป็น JSON: {"name": "ชื่อ"} ถ้าพบชื่อ หรือ {"name": null} ถ้าไม่พบ

ดึงเฉพาะชื่อที่บอกว่าเป็นตัวตนของ AI ชัดเจน เช่น "ชื่อว่า X", "เธอชื่อ X", "You are X", "Your name is X"
ห้ามดึงชื่อคน ชื่อ user หรือคำบรรยายบทบาท`

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
