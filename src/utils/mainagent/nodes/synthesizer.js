// synthesizer — Evaluator ที่พ่น 2 ส่วน:
//   command   → ส่งให้ router2 (blindfold) ทำตามตรง ๆ
//   narration → ให้ user เห็นเป็น interim chip ระหว่าง plan ก้อนถัดไปจะมา

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator — ประเมินเงื่อนไขจากคำสั่งของ user เทียบกับข้อมูลที่ค้นมา แล้วพ่นออกมา 2 ส่วน

1) command — "คำสั่งปฏิบัติการ" สั้น ๆ ส่งให้ Executor ทำงานต่อ
   - ถ้าข้อมูลเข้าเงื่อนไข → สั่งงานอุปกรณ์ตรง ๆ เช่น "เปิดไฟห้องนอน", "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา"
   - ถ้าไม่เข้าเงื่อนไข / ข้อมูลไม่พอ → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"
   - 1 ประโยค ระบุอุปกรณ์ให้ชัด ห้ามมีอีโมจิ / markdown
   - ต้องสอดคล้องกับ narration ที่ตอบในข้อ 2

2) narration — เล่าให้ user ฟังว่ากำลังทำอะไรอยู่ ดูบทพูดต่อเนื่องจาก action
   - **ต้องเริ่มด้วยคำกริยา** เช่น "ดู...", "เช็ก...", "หาข้อมูลแล้ว...", "ตรวจ..."
   - บอกข้อเท็จจริงจากที่ค้นมา (ตัวเลข/สถานะสั้น ๆ) แล้วต่อด้วย action ที่จะทำ
   - ตัวอย่าง: "ดูราคา NVDA แล้ว ขึ้น 5.77% จากสัปดาห์ก่อน จัดเปิดไฟหน้าบ้านให้"
   - ตัวอย่าง: "เช็กราคา BTC แล้ว ลง 4% เลยไม่ต้องเปิดไฟตามเงื่อนไข"
   - 1 ประโยค ภาษาธรรมชาติ ห้ามใส่อีโมจิ / markdown / ชื่อตัวเอง`

const SYNTHESIZER_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'คำสั่งปฏิบัติการสั้น ๆ สำหรับ Executor (เช่น "เปิดไฟห้องนอน" หรือ "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร")',
    },
    narration: {
      type: 'string',
      description: 'ประโยคบรรยายให้ user ฟัง เริ่มด้วยคำกริยา 1 ประโยค',
    },
  },
  required: ['command', 'narration'],
}

export async function synthesizerNode(state) {
  const { settings, signal, completed, messages, onInterimStatus } = state
  if (!completed?.length) return { router_context: '' }

  const userText = (() => {
    const list = messages || []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      const type = m?._getType?.() || m?.constructor?.name
      if (type === 'human' || type === 'HumanMessage') return String(m.content || '')
    }
    return ''
  })()

  const llm = makeLLM(settings, {
    temperature: 0.2,
    maxTokens: 250,
    structured: SYNTHESIZER_SCHEMA,
  })
  const input = `[user สั่งอะไรไว้]
${userText}

[ผลที่ค้นมา]
${completed.map(c => `- ${c}`).join('\n')}`

  let command = ''
  let narration = ''
  try {
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZE_PROMPT), new HumanMessage(input)],
      { signal }
    )
    command = String(res?.command || '').trim()
    narration = String(res?.narration || '').trim()
  } catch (err) {
    console.warn('  [Synthesizer] failed:', err?.message)
    command = 'ข้อมูลไม่พอ ไม่ต้องทำอะไร'
    narration = 'ประเมินข้อมูลไม่สำเร็จ ขอข้ามไปก่อน'
  }

  if (narration) onInterimStatus?.(narration)

  console.log(`  [Synthesizer] command="${command.slice(0, 80)}" | narration="${narration.slice(0, 80)}"`)
  return { router_context: command || narration }
}
