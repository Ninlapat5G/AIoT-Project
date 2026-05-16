import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'
import { parseJSON } from './jsonParser'

const SUMMARIZER_PROMPT = `วิเคราะห์บทสนทนาและสถานะอุปกรณ์ด้านล่าง แล้วตอบเป็น JSON เท่านั้น ห้ามพิมพ์อื่นนอกจาก JSON

รูปแบบที่ต้องตอบ:
ถ้ามีแค่บทสนทนาทั่วไป:
{"section1": "bullet summary ของบทสนทนา"}

ถ้ามีการสั่งอุปกรณ์ด้วย:
{"section1": "bullet summary ของบทสนทนาทั่วไป (ถ้าไม่มีให้ใส่ empty string)", "section2": "bullet summary ของคำสั่งอุปกรณ์"}

[section1 — บทสนทนาทั่วไป]
สรุปสั้นๆ เฉพาะเรื่องที่ user พูดถึงที่ไม่ใช่การสั่งงานอุปกรณ์ เช่น ทักทาย บ่น คุยเล่น ถามเรื่องทั่วไป
ถ้าไม่มีให้ใส่ "" (empty string)

[section2 — การสั่งงานอุปกรณ์]
ใส่เฉพาะเมื่อมีการสั่ง Smart Home หรือ Hub เท่านั้น
เรียงตามลำดับเวลา เชื่อมโยง clarify chain ไว้ด้วย เช่น
- ปิดไฟห้องน้ำแล้ว
- สั่งเปิดแอร์ → ระบบถามกี่องศา → user บอก 25 → ตั้งแอร์ 25 องศาแล้ว (ล่าสุด)
ถ้ายังรอคำตอบ user อยู่ให้ขึ้นต้นว่า "รอคำตอบ: ..."
ใส่ (ล่าสุด) ต่อท้าย item สุดท้าย
ใช้ชื่ออุปกรณ์จาก KG ให้ถูกต้อง
ถ้าไม่มีการสั่งอุปกรณ์เลย → ไม่ต้องใส่ field section2

[กฎเหล็ก]
- ตอบ JSON เท่านั้น ห้ามมีข้อความอื่น
- ห้ามแต่งประโยค ห้ามใส่อารมณ์`

// สรุป history ทั้งหมด (รวม message ล่าสุดเพื่อให้ LLM เข้าใจบริบทครบ)
// คืน { messages: [HumanMessage(section1), lastUserMsg], lastCommand: section2 | null }
export async function summarizeHistory(messages, settings, signal, kgSnapshot = '') {
  if (messages.length <= 1) return { messages, lastCommand: null }

  const historyText = messages.map(msg => {
    if (msg instanceof HumanMessage) return `User: ${msg.content}`
    if (msg instanceof AIMessage)    return `Assistant: ${msg.content}`
    return ''
  }).filter(Boolean).join('\n')

  if (!historyText) return { messages, lastCommand: null }

  const inputText = kgSnapshot
    ? `[สถานะอุปกรณ์ปัจจุบัน]\n${kgSnapshot}\n\n[บทสนทนา]\n${historyText}`
    : historyText

  try {
    const llm = makeLLM(settings, { temperature: 0, maxTokens: 500 })
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZER_PROMPT), new HumanMessage(inputText)],
      { signal }
    )

    let section1 = ''
    let lastCommand = null

    try {
      const parsed = parseJSON(String(res.content || ''))
      section1 = parsed?.section1 || ''
      lastCommand = parsed?.section2 || null
    } catch {
      // LLM ตอบ plain text แทน JSON — ใช้ตรงๆ เป็น section1
      section1 = String(res.content || '').trim()
    }

    console.log(`  [Summarizer] compressed ${messages.length} msgs → section1:${section1.length}c${lastCommand ? ' + section2' : ''}`)

    const historyMsg = new HumanMessage(
      `[ประวัติการสนทนาก่อนหน้า]\n${section1}`
    )
    return {
      messages: [historyMsg, messages[messages.length - 1]],
      lastCommand,
    }
  } catch (err) {
    console.warn('[Summarizer] failed, falling back to full history:', err?.message)
    return { messages, lastCommand: null }
  }
}
