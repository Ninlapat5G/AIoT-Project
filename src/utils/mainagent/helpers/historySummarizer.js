import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'
import { parseJSON } from './jsonParser'

const SUMMARIZER_PROMPT = `วิเคราะห์บทสนทนาและสถานะอุปกรณ์ด้านล่าง แล้วตอบเป็น JSON เท่านั้น ห้ามพิมพ์อื่นนอกจาก JSON

รูปแบบที่ต้องตอบ:
{"section1": "...", "section2": "..."}
ถ้าไม่มี section2 ให้ละ field นั้นออก

[section1 — บทสนทนาและข้อมูลทั่วไป]
ครอบคลุมทุกเรื่องที่ไม่ใช่การสั่งงานอุปกรณ์โดยตรง ได้แก่:
- การสนทนา: ทักทาย คุยเล่น บ่น ถามตอบทั่วไป
- ผลค้นหาจากเว็บ: สรุปใจความที่ระบบแจ้ง user (เช่น "- แจ้งพยากรณ์อากาศกรุงเทพ: ฝนตกช่วงบ่าย")
- การตั้งค่าระบบ: เปิด/ปิด skill, ดู API key (เช่น "- ปิด skill web_search แล้ว")
- อุปกรณ์ที่ไม่พบ: (เช่น "- ไม่พบ 'ไฟห้องใต้ดิน' ในระบบ")
ถ้าไม่มีเนื้อหาตามหมวดด้านบน ให้สรุปเนื้อหาบทสนทนาที่มีอยู่ไว้ตามปกติ อย่าใส่ค่าว่าง

[section2 — การสั่งงานอุปกรณ์]
ใส่เฉพาะเมื่อมีการสั่ง Smart Home หรือ Hub เท่านั้น
เรียงตามลำดับเวลา ใช้ชื่ออุปกรณ์ตาม KG

รูปแบบแต่ละ item:
- คำสั่งที่สำเร็จ: "- ปิดไฟห้องน้ำแล้ว (ล่าสุด)"
- คำสั่งที่ยังไม่ครบข้อมูล: "- user สั่ง[อะไร] (รอคำตอบ)"
  เช่น user พิมพ์ "เปิดแอร์" แต่ยังไม่บอกอุณหภูมิ → "- user สั่งเปิดแอร์ห้องนอน (รอคำตอบ)"
  เช่น user พิมพ์ "เปิดไฟ" แต่ยังไม่บอกห้อง → "- user สั่งเปิดไฟ (รอคำตอบ)"
- clarify chain ที่ครบแล้ว: "- user สั่งเปิดแอร์ → ตั้ง 25 องศาแล้ว (ล่าสุด)"

ใส่ (ล่าสุด) ต่อท้าย item สุดท้ายของทั้ง section เสมอ (ยกเว้น item นั้นเป็น (รอคำตอบ) อยู่แล้ว)
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
