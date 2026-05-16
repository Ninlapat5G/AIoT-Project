import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const SUMMARIZER_PROMPT = `วิเคราะห์และสรุปประวัติการสนทนาด้านล่าง แบ่งเป็น 2 section ดังนี้

[Section 1 — บทสนทนาทั่วไป]
สรุปสั้นๆ เฉพาะเรื่องที่ user เล่าหรือพูดถึงที่ไม่เกี่ยวกับการสั่งงานระบบ (ทักทาย, บ่น, คุยเล่น, ถามเรื่องทั่วไป)
ถ้าไม่มี → ข้าม section นี้ทั้งหมด (ไม่ต้องพิมพ์หัว)

[Section 2 — การสั่งงานอุปกรณ์]
แบ่งย่อยเป็น 2 หมวด:
- หมวด 1 (Smart Home / IoT): การเปิด/ปิด/ปรับอุปกรณ์ในบ้าน
- หมวด 2 (Hub / คอมพิวเตอร์): คำสั่งที่ส่งให้เครื่อง Hub

สำหรับแต่ละหมวด:
- แสดงรายการสิ่งที่ทำสำเร็จแล้ว (สั้นๆ เน้นเนื้อ)
- ถ้ามีคำสั่งที่ระบบถามกลับแล้วรอคำตอบ user → ให้ระบุชัดเจนว่า "รอคำตอบ: ..."
- ใส่วงเล็บ (ล่าสุด) ต่อท้าย item ที่เป็นคำสั่งล่าสุดของ user ในหมวดนั้น
- ถ้าหมวดไหนไม่มีข้อมูลเลย → ข้ามหมวดนั้น (ไม่ต้องพิมพ์หัว)

[กฎเหล็ก]
- ห้ามแต่งประโยค ห้ามใส่อารมณ์ เอาแค่เนื้อหาล้วนๆ
- ห้ามสรุปข้อความสุดท้ายของ user (ข้ามข้อความท้ายสุดไปเลย)
- ถ้าไม่มีข้อมูลในทั้ง 2 section → ตอบว่า "(ไม่มีประวัติ)"

ตัวอย่างผลลัพธ์ที่ถูกต้อง:
---
[Section 2 — การสั่งงานอุปกรณ์]
หมวด 1 (Smart Home):
- ปิดไฟห้องน้ำแล้ว
- สั่งเปิดแอร์ → ระบบถามว่าให้ตั้งกี่องศา → user บอก 25 องศา → ตั้งแอร์ 25 องศาแล้ว
- เปิดไฟหน้าบ้าน (ล่าสุด)
---`

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
