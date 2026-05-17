// synthesizer — "สมองส่วนประเมินผล" (Evaluator)
// อ่าน user request + ผลค้นข้อมูล → ประเมินเงื่อนไข → พ่นคำสั่งปฏิบัติการตรง ๆ
// ส่งต่อให้ router_planner รอบถัดไป (ที่ถูก "blindfold" ไม่เห็น user เดิม) ทำงานตามคำสั่งได้เลย

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator — ประเมินเงื่อนไขจากคำสั่งของ user เทียบกับข้อมูลที่ค้นมา แล้วพ่น "คำสั่งปฏิบัติการตรง ๆ" ส่งให้ Executor ทำงานต่อ

วิธีตอบ:
- ถ้าข้อมูลเข้าเงื่อนไขที่ user สั่ง → พ่นคำสั่งสั่งงานอุปกรณ์ตรง ๆ พร้อมระบุค่าให้ครบ
  ตัวอย่าง: "เปิดไฟห้องนอน", "ปิดไฟหน้าบ้าน", "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา", "หรี่ไฟห้องนอน 30%"
- ถ้าข้อมูลไม่เข้าเงื่อนไข หรือข้อมูลที่ค้นมายังไม่พอจะประเมิน → ตอบสั้น ๆ เพื่อยกเลิกงาน
  ตัวอย่าง: "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร", "ข้อมูลไม่พอ ไม่ต้องทำอะไร"

[กฎเหล็ก]
- ตอบ Plain text สั้น ๆ 1-2 ประโยค ห้ามมี JSON / code block / markdown เด็ดขาด
- ห้ามอธิบาย ห้ามเล่ารายละเอียดข้อมูล ห้ามใส่อีโมจิ — พ่นแค่คำสั่งตรง ๆ
- ระบุอุปกรณ์เป้าหมายให้ชัด (เช่น "ไฟหน้าบ้าน" ไม่ใช่ "ไฟ")`

export async function synthesizerNode(state) {
  const { settings, signal, completed, messages, onInterimStatus } = state
  if (!completed?.length) return { router_context: '' }

  onInterimStatus?.('กำลังประเมินข้อมูลที่ได้มา')

  const userText = (() => {
    const list = messages || []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      const type = m?._getType?.() || m?.constructor?.name
      if (type === 'human' || type === 'HumanMessage') return String(m.content || '')
    }
    return ''
  })()

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 120 })
  const input = `[user สั่งอะไรไว้]
${userText}

[ผลที่ค้นมา]
${completed.map(c => `- ${c}`).join('\n')}`

  let summary = ''
  try {
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZE_PROMPT), new HumanMessage(input)],
      { signal }
    )
    summary = String(res.content || '').trim()
  } catch (err) {
    console.warn('  [Synthesizer] failed:', err?.message)
    summary = 'ข้อมูลไม่พอ ไม่ต้องทำอะไร'
  }

  console.log(`  [Synthesizer] → ${summary.slice(0, 120)}${summary.length > 120 ? '...' : ''}`)
  return { router_context: summary }
}
