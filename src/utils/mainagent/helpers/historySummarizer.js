import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory.js'
import { parseJSON } from './jsonParser.js'

const SUMMARIZER_PROMPT = `คุณคือระบบบีบอัดความจำของ SynaptaOS วิเคราะห์บทสนทนาแล้วตอบเป็น JSON ก้อนเดียว ห้ามมีข้อความอื่น

[รูปแบบ JSON]
{
  "chat_summary": "เฉพาะบทสนทนาทั่วไปที่ไม่ใช่คำสั่งอุปกรณ์ เช่น ทักทาย ถามความรู้ ผลค้นหาเว็บ เขียนเป็น Bullet points สั้น (ว่างได้ถ้าไม่มี — ห้ามใส่ข้อมูลที่อยู่ใน last_command หรือ pending_answer ซ้ำ)",
  "last_command": "คำสั่งอุปกรณ์ล่าสุด 1 รายการ เช่น 'เปิดไฟห้องนั่งเล่น (ล่าสุด)' (ว่างได้ถ้าไม่มีการสั่งอุปกรณ์)",
  "pending_answer": "สิ่งที่รอคำตอบชัดเจนจาก user เขียน 1 บรรทัด เช่น 'รอ user ตอบว่าจะตั้งแอร์กี่องศา' หรือ 'งาน home_control ล้มเหลว รอ user สั่งต่อ' (ว่างถ้าไม่มีอะไรค้าง)"
}

[กฎ]
1. ตอบ JSON เท่านั้น ใช้ double quote เสมอ
2. สรุปเป็น fact สั้น ห้ามคัดลอก history ยาวกลับมา
3. แต่ละ field มีหน้าที่ชัดเจน ห้ามใส่ข้อมูลซ้ำข้ามกัน
4. ข้อมูลเป็นภาษาไทย กระชับ ไม่ใส่อารมณ์`

export async function summarizeHistory(messages, settings, signal, kgSnapshot = '', pendingContext = '') {
  if (messages.length === 0) return { chat_summary: '', last_command: null, pending_answer: '' }

  const historyText = messages.map(msg => {
    if (msg instanceof HumanMessage) return `User: ${msg.content}`
    if (msg instanceof AIMessage)    return `Assistant: ${msg.content}`
    return ''
  }).filter(Boolean).join('\n')

  const parts = []
  if (kgSnapshot) parts.push(`[สถานะอุปกรณ์ปัจจุบัน]\n${kgSnapshot}`)
  parts.push(`[บทสนทนาทั้งหมดในรอบนี้]\n${historyText}`)
  if (pendingContext) parts.push(`[หมายเหตุระบบ — ใช้ช่วย pending_answer]\n${pendingContext}`)
  const inputText = parts.join('\n\n')

  try {
    const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZER_PROMPT), new HumanMessage(inputText)],
      { signal }
    )

    const parsed = parseJSON(String(res.content || ''))
    return {
      chat_summary:  parsed?.chat_summary  || '',
      last_command:  parsed?.last_command  || null,
      pending_answer: parsed?.pending_answer || '',
    }
  } catch (err) {
    console.warn('[Summarizer] failed to compress history:', err?.message)
    return { chat_summary: '', last_command: null, pending_answer: '' }
  }
}
