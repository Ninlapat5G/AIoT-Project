import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const SUMMARIZER_PROMPT = `สรุปบทสนทนาต่อไปนี้เป็นรายการ bullet สั้นๆ เชิงข้อเท็จจริง
ห้ามมีบุคลิก ห้ามใช้ภาษาสวยงาม ห้ามเพิ่มข้อมูลนอกบทสนทนา
แต่ละ bullet คือ 1 สิ่งที่ระบบทำสำเร็จแล้ว (past tense) เช่น "- เสร็จแล้ว: ปิดไฟห้องนั่งเล่น"
ห้ามพูดถึงคำสั่งล่าสุด (ไม่ต้องสรุป turn สุดท้ายของ user)`

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
      new HumanMessage(`[ประวัติการสนทนา — action เหล่านี้ทำเสร็จแล้ว อย่านำมาสร้างใน plan ใหม่]\n${summary}`),
      messages[messages.length - 1],
    ]
  } catch (err) {
    console.warn('[Summarizer] failed, falling back to full history:', err?.message)
    return messages
  }
}
