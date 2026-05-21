import { SystemMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const CHAT_PERSONA_BASE = `[กฎการทำงาน]
- ตอบเป็นธรรมชาติ เป็นกันเอง กระชับ
- ถ้าต้องขอข้อมูลเพิ่มเพื่อทำงานต่อ ถามตรงๆ ได้เลย
- อย่าพูดถึงสถานะอุปกรณ์ถ้า user ไม่ได้ถาม
- ห้ามตอบเป็น JSON หรือ code block`

export async function chatNode(state) {
  const t0 = Date.now()
  console.log('  [Chat] start')
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

  let finalMsg
  const stream = await llm.stream([new SystemMessage(persona), ...messages], { signal })
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content)
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk
  }

  const text = String(finalMsg?.content || '')
  console.log(`  [Chat] → ${text.slice(0, 120)}${text.length > 120 ? '...' : ''} (${Date.now() - t0}ms)`)

  // ถ้า router ให้ถามกลับ user → ตั้ง pending_answer ทันที ไม่รอ summarizer อนุมาน
  return { messages: [finalMsg], ...(hint ? { pending_answer: hint } : {}) }
}