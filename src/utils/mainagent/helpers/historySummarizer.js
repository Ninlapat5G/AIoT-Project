import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory.js'
import { parseJSON } from './jsonParser.js'

const SUMMARIZER_PROMPT = `คุณคือระบบบีบอัดความจำ (Memory Compressor) ของ SynaptaOS หน้าที่ของคุณคือวิเคราะห์ประวัติการสนทนาทั้งหมดรวมถึงรอบล่าสุด แล้วสรุปออกมาเป็นโครงสร้าง JSON ตามรูปแบบที่กำหนดเท่านั้น ห้ามมีข้อความเกริ่นนำหรืออธิบายใดๆ นอกเหนือจาก JSON เด็ดขาด

[รูปแบบ JSON ที่ต้องการ]
{
  "chat_summary": "สรุปเนื้อหาการคุยเล่น ทักทาย ถามไถ่ หรือผลการค้นหาเว็บที่ผ่านมาในรอบนี้ โดยเขียนเป็น Bullet points สั้นๆ กระชับ (หากไม่มีให้ใส่เป็นข้อความว่าง \\"\\")",
  "last_command": "สรุปสถานะคำสั่งอุปกรณ์ล่าสุดเพียง 1 รายการเท่านั้น เช่น คำสั่งที่สำเร็จแล้วให้อ้างอิงและต่อท้ายด้วย (ล่าสุด) หรือถ้าเป็นคำสั่งที่กำลังรอข้อมูลจากผู้ใช้ให้ระบุชัดเจนว่ารออะไรและต่อท้ายด้วย (รอคำตอบ) (หากไม่มีการสั่งอุปกรณ์เลยในประวัติ ให้ใส่เป็นข้อความว่าง \\"\\")"
}

[กฎเหล็กขั้นเด็ดขาด]
1. ต้องตอบเป็น JSON Format ที่ถูกต้องและใช้ Double Quote (\\") เท่านั้น
2. ห้ามใช้คำว่า 'ให้คงข้อความเดิมไว้' หรือคัดลอกประวัติยาวๆ กลับมาเด็ดขาด ให้สรุปเป็น Fact สั้นๆ 
3. ข้อมูลต้องเป็นภาษาไทยที่เป็นกลาง กระชับ ไม่ใส่อารมณ์`

export async function summarizeHistory(messages, settings, signal, kgSnapshot = '') {
  if (messages.length === 0) return { chat_summary: '', last_command: null }

  const historyText = messages.map(msg => {
    if (msg instanceof HumanMessage) return `User: ${msg.content}`
    if (msg instanceof AIMessage)    return `Assistant: ${msg.content}`
    return ''
  }).filter(Boolean).join('\n')

  const inputText = kgSnapshot
    ? `[สถานะอุปกรณ์ปัจจุบัน]\n${kgSnapshot}\n\n[บทสนทนาทั้งหมดในรอบนี้]\n${historyText}`
    : historyText

  try {
    const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZER_PROMPT), new HumanMessage(inputText)],
      { signal }
    )

    const parsed = parseJSON(String(res.content || ''))
    return {
      chat_summary: parsed?.chat_summary || '',
      last_command: parsed?.last_command || null
    }
  } catch (err) {
    console.warn('[Summarizer] failed to compress history:', err?.message)
    return { chat_summary: '', last_command: null }
  }
}