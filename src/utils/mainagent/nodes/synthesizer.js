// synthesizer — Evaluator
// อ่าน user request + ผลค้นข้อมูล → ประเมินเงื่อนไข → พ่นคำสั่งปฏิบัติการตรง ๆ ส่งให้ router2
// (ไม่ stream ออก user — UI ใช้ interim chip "กำลังตัดสินใจขั้นถัดไป" ของ router แทน)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator — ประเมินเงื่อนไขจากคำสั่งของ user เทียบกับข้อมูลที่ค้นมา แล้วพ่น "คำสั่งปฏิบัติการ" 1 ประโยคส่งให้ Executor ทำงานต่อ

วิธีตอบ:
- ถ้าข้อมูลเข้าเงื่อนไข → สั่งงานอุปกรณ์ตรง ๆ พร้อมระบุค่าให้ครบ
  ตัวอย่าง: "เปิดไฟหน้าบ้าน", "ปิดไฟห้องนอน", "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา"
- ถ้าไม่เข้าเงื่อนไข / ข้อมูลไม่พอ → ตอบยกเลิก
  ตัวอย่าง: "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

[กฎ]
- Plain text 1 ประโยค ห้าม JSON / markdown / code block / อีโมจิ
- ระบุอุปกรณ์ให้ชัด (เช่น "ไฟหน้าบ้าน" ไม่ใช่ "ไฟ")`

export async function synthesizerNode(state) {
  const { settings, signal, completed, messages, onInterimStatus } = state
  if (!completed?.length) return { router_context: '' }

  onInterimStatus?.('กำลังตัดสินใจขั้นถัดไป')

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

  let command = ''
  try {
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZE_PROMPT), new HumanMessage(input)],
      { signal }
    )
    command = String(res?.content || '').trim()
  } catch (err) {
    console.warn('  [Synthesizer] failed:', err?.message)
    command = 'เงื่อนไขไม่ตรง ไม่ต้องทำอะไร'
  }

  console.log(`  [Synthesizer] command="${command.slice(0, 100)}"`)
  return { router_context: command }
}
