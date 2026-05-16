import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const SUMMARIZER_PROMPT = `ย่อบทสนทนาด้านล่างเป็น bullet สั้นๆ เนื้อล้วน — ครอบคลุมทั้งสิ่งที่ทำสำเร็จ คำถามที่ถามค้างไว้ และคำตอบของ user เช่น
- user สั่งเปิดแอร์ → ระบบถามว่าให้ตั้งกี่องศา
- user บอก 25 องศา → ระบบตั้งแอร์ 25 องศาแล้ว
- user ถาม "พรุ่งนี้ฝนตกมั้ย" → ระบบหาข้อมูลพยากรณ์ให้แล้ว
ไม่ต้องแต่งประโยค ไม่ต้องมีอารมณ์ — เอาแค่เนื้อหาสำคัญที่ต้องจำ (ข้ามข้อความสุดท้ายของ user ออก ไม่ต้องเอามาสรุป)`

// บีบ history ทั้งหมดยกเว้น user message ล่าสุด เป็น bullet summary
// คืน [HumanMessage(summary), lastUserMsg]
export async function summarizeHistory(messages, settings, signal) {
  if (messages.length <= 1) return messages

  const historyText = messages.slice(0, -1).map(msg => {
    if (msg instanceof HumanMessage) return `User: ${msg.content}`
    if (msg instanceof AIMessage)    return `Assistant: ${msg.content}`
    return ''
  }).filter(Boolean).join('\n')

  if (!historyText) return messages

  try {
    const llm = makeLLM(settings, { temperature: 0, maxTokens: 300 })
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZER_PROMPT), new HumanMessage(historyText)],
      { signal }
    )
    const summary = String(res.content || '').trim()
    console.log(`  [Summarizer] compressed ${messages.length - 1} msgs → ${summary.length} chars`)
    return [
      new HumanMessage(`[ประวัติการสนทนาก่อนหน้า]\n${summary}`),
      messages[messages.length - 1],
    ]
  } catch (err) {
    console.warn('[Summarizer] failed, falling back to full history:', err?.message)
    return messages
  }
}
