import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'

const PERSONA_BASE = `หน้าที่ของคุณ: เล่าให้ user ฟังว่าระบบเพิ่งทำอะไรไปบ้าง โดยดูจากรายการ [สิ่งที่ดำเนินการสำเร็จในรอบนี้] ห้ามมโนเพิ่มหรือแต่งเรื่องเองเด็ดขาด`

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
- พูดสั้นๆ แค่ 1-2 ประโยคแบบเป็นกันเอง ภาษาไทยธรรมชาติ
- เล่าเฉพาะสิ่งที่ทำเสร็จแล้วจริงๆ
- ตัวเลของศาแอร์ต้องเป๊ะตามรายการ ห้ามเอาไปบวกลบเพิ่มเอง
- ห้ามตอบกลับมาเป็น JSON หรือ Code block เด็ดขาด`
}

export async function responseNode(state) {
  const { settings, signal, onStream } = state
  const messages = state.messages || []

  const persona = settings.systemPrompt || 'You are a helpful smart home assistant.'
  const ctxText = buildContext(state)

  const llm = makeLLM(settings, { temperature: 0.3 })

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
  console.log(`  [Response] → ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)

  return { messages: [finalMsg] }
}