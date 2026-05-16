// chat_node — สำหรับ plan ที่มีแต่ general step (คุยเล่น/clarify)
//
// LLM ครั้งที่ 2 ตอบเป็นตัวซิน ใช้ persona ของ user

import { SystemMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

const CHAT_PERSONA_BASE = `คุยเล่นแบบเป็นกันเอง สดใส และกระชับ ถ้าต้องถามข้อมูลเพิ่มเพื่อไปทำงานต่อ ให้ถามผู้ใช้ตรงๆ ได้เลย และอย่าพูดเรื่องสถานะอุปกรณ์ถ้าเขาไม่ได้ถาม`

export async function chatNode(state) {
  const { settings, signal, plan, onStream } = state
  const messages = state.messages || []

  const steps = plan?.steps || []
  const hint = steps
    .filter(s => s.type === 'general' && s.response)
    .map(s => s.response)
    .join('\n')

  const persona = [
    settings.systemPrompt || 'You are a helpful smart home assistant.',
    CHAT_PERSONA_BASE,
    hint ? `ต้องพูดว่า: ${hint}` : '',
  ].filter(Boolean).join('\n\n')

  const llm = makeLLM(settings, { temperature: 0.3 })
  const msgsCtx = messages.length > 1
    ? await summarizeHistory(messages, settings, signal)
    : messages

  let finalMsg
  const stream = await llm.stream([new SystemMessage(persona), ...msgsCtx], { signal })
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content)
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk
  }

  const text = String(finalMsg?.content || '')
  console.log(`  [Chat] → ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)

  return { messages: [finalMsg] }
}
