// response — LLM ครั้งที่ 2: สรุปผลที่ทำให้ user เป็นภาษาธรรมชาติ
//
// อ่าน state.completed (รายการที่ plan_executor ทำสำเร็จ) → stream ตอบ

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

const PERSONA_BASE = `หน้าที่ตอนนี้: อ่านรายการ [สิ่งที่ดำเนินการ] แล้วรายงานให้ user รู้ว่าระบบทำอะไรไปบ้าง
ห้ามเพิ่มเติมหรือสรุปเกินกว่าที่อยู่ในรายการนั้น`

function buildContext(state) {
  const settings = state.settings
  const devices = (state.deviceList?.current ?? state.deviceList) || []
  const completed = state.completed || []

  const completedStr = completed.length
    ? completed.map(c => c.startsWith('✗') ? `  ${c}` : `  ✓ ${c}`).join('\n')
    : '  (ไม่มีการดำเนินการ)'

  const errors = completed.filter(c => c.startsWith('✗'))
  const errorSection = errors.length
    ? `\n[ข้อผิดพลาด]\n${errors.map(e => `  ${e}`).join('\n')}\n`
    : ''

  return `
[สถานะอุปกรณ์ปัจจุบัน]
${snapshotText({ devices, settings, now: nowString() })}

[สิ่งที่ระบบดำเนินการสำเร็จในรอบนี้ — ค่าเหล่านี้คือผลลัพธ์สุดท้ายหลังจากทำเสร็จแล้ว]
${completedStr}
${errorSection}
[กฎเหล็ก]
- รายงานเฉพาะสิ่งที่อยู่ใน [สิ่งที่ดำเนินการ] เท่านั้น ห้ามเพิ่ม ห้ามเดา ห้ามแต่งเอง
- ตัวเลของศาในคำตอบต้องตรงกับตัวเลขใน [สิ่งที่ดำเนินการ] ทุกตัว ห้ามบวก/ลบ/คำนวณเพิ่ม
- ค่าในรายการคือค่าหลังดำเนินการเสร็จแล้ว ไม่ใช่ค่าก่อนดำเนินการ
- พูด 1-2 ประโยค ภาษาไทย กระชับ เป็นมิตร
- ห้ามตอบเป็น JSON หรือ code block`
}

export async function responseNode(state) {
  const { settings, signal, onStream } = state
  const messages = state.messages || []

  const persona = settings.systemPrompt || 'You are a helpful smart home assistant.'
  const ctxText = buildContext(state)

  const llm = makeLLM(settings, { temperature: 0.3 })
  const msgsCtx = messages.length > 1
    ? await summarizeHistory(messages, settings, signal)
    : messages

  // ย้าย ctx ไปแปะท้าย HumanMessage สุดท้าย ให้ rules อยู่ใกล้จุด generate
  const last = msgsCtx[msgsCtx.length - 1]
  const lastWithCtx = new HumanMessage({
    content: String(last?.content || '') + ctxText,
  })

  let finalMsg
  const stream = await llm.stream(
    [
      new SystemMessage(persona),
      new SystemMessage(PERSONA_BASE),
      ...msgsCtx.slice(0, -1),
      lastWithCtx,
    ],
    { signal }
  )
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content)
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk
  }

  const text = String(finalMsg?.content || '')
  console.log(`  [Response] → ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)

  return { messages: [finalMsg] }
}
