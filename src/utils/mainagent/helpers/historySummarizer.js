import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'
import { parseJSON } from './jsonParser'

const SUMMARIZER_PROMPT = `วิเคราะห์และสรุปประวัติการสนทนาด้านล่าง แล้วตอบกลับเป็นโครงสร้าง JSON เท่านั้น ห้ามมีข้อความอื่นเจือปนเด็ดขาด

[รูปแบบ JSON ที่อนุญาต]
{
  "section1": "สรุปข้อมูลทั่วไป...",
  "section2": "คำสั่งอุปกรณ์ล่าสุด..."
}

[กฎของ section1 — ข้อมูลทั่วไปและบริบท]
- สรุปเรื่องที่ไม่ใช่การสั่งอุปกรณ์โดยตรง (เช่น ทักทาย, คุยเล่น, ผลค้นหาจากเว็บ, การตั้งค่าระบบ, แจ้งเตือนไม่พบอุปกรณ์)
- เขียนเป็น Bullet points (ใช้ - นำหน้า) ถ้ามีหลายข้อให้คั่นด้วย \n
- ถ้าไม่มีเนื้อหาหมวดนี้เลย: ให้ใส่ string ว่า "- (ไม่มีข้อมูลทั่วไป)" (ห้ามปล่อยเป็นค่าว่าง)

[กฎของ section2 — คำสั่งอุปกรณ์ล่าสุดเท่านั้น]
- พิจารณาเฉพาะ "คำสั่งล่าสุดที่สุด" ของ Smart Home หรือ Hub เพียง 1 รายการเท่านั้น ไม่ต้องสรุปคำสั่งก่อนหน้าทั้งหมด
- คำสั่งที่สำเร็จ: เช่น "- ปิดไฟห้องน้ำแล้ว (ล่าสุด)"
- คำสั่งที่ยังรอข้อมูล: เช่น "- user สั่งเปิดแอร์ (รอคำตอบ)" หรือ "- user สั่งเปิดไฟ (รอคำตอบ)"
- clarify chain ที่จบครบแล้ว: เช่น "- user สั่งเปิดแอร์ → ตั้ง 25 องศาแล้ว (ล่าสุด)"
- ถ้าคำสั่งล่าสุดสำเร็จแล้ว ให้ใส่ "(ล่าสุด)" ต่อท้าย (ยกเว้น item นั้นมี "(รอคำตอบ)" อยู่แล้ว ไม่ต้องใส่ซ้ำ)
- ถ้าไม่มีการสั่งอุปกรณ์เลย: ให้ตัด key "section2" ทิ้งไปเลย ห้ามใส่เข้ามาใน JSON เด็ดขาด

[กฎเหล็กขั้นเด็ดขาด]
1. ต้องตอบเป็น JSON Format ที่ถูกต้องเท่านั้น (Valid JSON)
2. ห้ามใช้ Single Quote (') ครอบ Key หรือ Value ให้ใช้ Double Quote (") ตามมาตรฐาน JSON
3. ห้ามแต่งประโยค ห้ามใส่อารมณ์ เอาแค่ข้อเท็จจริง (Fact)
4. ห้ามพิมพ์ข้อความอธิบายใดๆ นอกเหนือจากตัว JSON`

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
