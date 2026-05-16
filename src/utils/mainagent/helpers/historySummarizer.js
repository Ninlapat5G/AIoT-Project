import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory'

const SUMMARIZER_PROMPT = `สรุปประวัติการสนทนาด้านล่างให้เป็น Bullet points สั้นๆ แบบ Fact-based เพื่อใช้เป็นบริบท (State Tracking) ให้กับระบบ

เป้าหมาย: บันทึก "สิ่งที่ดำเนินการสำเร็จไปแล้ว" "คำสั่งที่ยังค้างอยู่" และ "ข้อมูลทั่วไปที่ user เล่า" อย่างครบถ้วน

[ขอบเขตข้อมูลที่ต้องสรุป]
1. IoT / Smart Home: การสั่งงานอุปกรณ์, การตั้งค่า (เช่น "- ปิดไฟห้องนั่งเล่นแล้ว", "- ตั้งแอร์ห้องนอนเป็น 25 องศาแล้ว")
2. Hub Control: คำสั่งที่ส่งให้เครื่องคอมพิวเตอร์/Hub และผลลัพธ์ (เช่น "- รายงานสถานะ CPU Usage ให้แล้ว")
3. Web / Realtime Data: การค้นหาข้อมูลออนไลน์ (เช่น "- แจ้งพยากรณ์อากาศกรุงเทพแล้ว")
4. Settings / System: การตั้งค่าระบบ, สถานะ API Key (เช่น "- อธิบายวิธีขอ API Key แล้ว")
5. General Chat / บทสนทนาทั่วไป: การทักทาย หรือเรื่องที่ user เล่าให้ฟัง ให้สรุปแค่ใจความว่า user บอกอะไร (เช่น "- user บ่นว่าวันนี้อากาศร้อน")

[กฎการสรุป]
1. สิ่งที่ทำจบแล้ว: สรุปผลลัพธ์สั้นๆ เอาเฉพาะใจความสำคัญ
2. บริบทที่ต่อเนื่องกัน (สำคัญมาก!): ถ้ามีการถาม-ตอบเพื่อรอข้อมูล ให้สรุปเรียงตามลำดับความเชื่อมโยง เช่น
   - user สั่งเปิดแอร์ → ระบบถามว่าให้ตั้งกี่องศา
   - user บอก 25 องศา → ระบบตั้งแอร์ 25 องศาแล้ว
3. ข้อมูลอ้างอิง: หาก user ระบุข้อมูลเฉพาะ (ชื่อห้อง, ตัวเลข, ความชอบ) ให้จดไว้สั้นๆ ด้วย
4. [ล่าสุด] tag (สำหรับหมวด 1-4 เท่านั้น): ให้ใส่ [ล่าสุด] ต่อท้าย item สุดท้ายของแต่ละหมวด 1-4 เพื่อให้ระบบรู้ว่า action ก่อนหน้าคืออะไร เช่น "- ตั้งแอร์ 25 องศาแล้ว [ล่าสุด]"
5. สิ่งที่ห้ามทำ: ห้ามแต่งประโยคสวยงาม, ห้ามใส่อารมณ์, ห้ามคิดเองนอกเหนือจากแชท
6. คำเตือนเด็ดขาด: ห้ามสรุปข้อความสุดท้ายของ user (ข้ามข้อความท้ายสุดไปเลย) ให้อ่านแค่บริบทก่อนหน้าเท่านั้น`

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
