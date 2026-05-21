import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { knowledge_data } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'

const PERSONA_BASE = `[บทบาท]
แจ้งผล user ว่าระบบทำอะไรไปบ้าง ดูจาก [สิ่งที่ระบบดำเนินการสำเร็จในรอบนี้] เท่านั้น`

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
${knowledge_data({ devices, settings, now: nowString() })}

[สิ่งที่ระบบดำเนินการสำเร็จในรอบนี้ — ค่าเหล่านี้คือผลลัพธ์สุดท้ายหลังจากทำเสร็จแล้ว]
${completedStr}
${errorSection}
[กฎเหล็ก]
- พูดสั้นๆ แค่ 1-2 ประโยคแบบเป็นกันเอง ภาษาไทยธรรมชาติ
- เล่าเฉพาะสิ่งที่อยู่ใน [สิ่งที่ระบบดำเนินการสำเร็จในรอบนี้] เท่านั้น ห้ามแต่งข้อมูลหรือเพิ่มรายละเอียดที่ไม่มีในรายการนั้น
- ค่าตัวเลขต้องเป๊ะตามรายการ ห้ามเอาไปบวกลบเพิ่มเอง
- ห้ามพูดถึง device หรือ action ที่ไม่ได้อยู่ในรายการ
- ห้ามตอบกลับมาเป็น JSON หรือ Code block เด็ดขาด`
}

export async function responseNode(state) {
  const t0 = Date.now()
  console.log('  [Response] start')
  const { settings, signal, onStream, onInterimStatus } = state
  onInterimStatus?.('กำลังสรุปผล')
  const messages = state.messages || []

  const persona = settings.systemPrompt || 'You are a helpful smart home assistant.'
  const ctxText = buildContext(state)

  const llm = makeLLM(settings, { temperature: 0.2 })

  // ย้าย ctx ไปแปะท้าย HumanMessage สุดท้าย ให้ rules อยู่ใกล้จุด generate
  const last = messages[messages.length - 1]
  const lastWithCtx = new HumanMessage({
    content: String(last?.content || '') + ctxText,
  })

  let finalMsg
  const stream = await llm.stream(
    [
      new SystemMessage(persona),
      new SystemMessage(PERSONA_BASE),
      ...messages.slice(0, -1),
      lastWithCtx,
    ],
    { signal }
  )
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content)
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk
  }

  const text = String(finalMsg?.content || '')
  console.log(`  [Response] → ${text.slice(0, 120)}${text.length > 120 ? '...' : ''} (${Date.now() - t0}ms)`)

  return { messages: [finalMsg] }
}