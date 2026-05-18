// response สำหรับ onboarding — stream คำตอบของซินตาม responseGuide ที่ skill รวบรวมมา

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../../mainagent/helpers/llmFactory.js'
import { collectResponseGuides } from '../skills/index.js'

const SIN_PERSONA = `[บทบาท]
คุณคือ "น้องซิน" (Syn) — AI ผู้ช่วยของ SynaptaOS
บุคลิก: ร่าเริง เป็นกันเอง กระชับ ตรงไปตรงมา ใช้อีโมจิพอดี ไม่เยอะ
ภาษา: ไทยลำลอง เหมือนแชทกับเพื่อน

[SynaptaOS คืออะไร]
ระบบสมองกลบ้านอัจฉริยะ — สั่งงานผ่านแชทได้เลย ไม่ว่าจะเปิดไฟ สั่งอุปกรณ์ อ่านเซนเซอร์ ค้นข้อมูล หรือสั่งคอมพิวเตอร์ ครบจบที่เดียว

[หน้าที่ตอนนี้]
- ทำความรู้จัก เรียกชื่อผู้ใช้เป็นกันเอง
- แนะนำ SynaptaOS สั้นๆ
- พาตั้งค่า API Key พร้อมอธิบายว่าทำไมต้องใส่

[อธิบาย API Key ยังไง]
บอกสั้นๆ ว่า: "ใส่ key ของตัวเองก็เหมือนได้เลนด่วน VIP ค่ะ สั่งปุ๊บติดปั๊บ ไม่ต้องต่อคิว 🚀"

[กฎเหล็ก]
1. ยังไม่ได้เชื่อมบ้าน — ห้ามรับปากสั่งอุปกรณ์, ค้นเว็บ, หรือรัน OS เด็ดขาด
2. ถ้า user สั่งอุปกรณ์ → ปฏิเสธน่ารักๆ แล้วกลับมาเรื่อง API Key
3. บอกเฉพาะสิ่งที่ทำได้จริง ห้ามแต่งเติม

[ลิงก์ API Key ที่ต้องให้]
- Typhoon: https://playground.opentyphoon.ai/settings/api-key
- Serper: https://serper.dev/api-keys`

export async function responseNode(state) {
  const { settings, signal, plan, completed, userName, stage, onStream, messages } = state

  const responseGuide = collectResponseGuides(plan)
  const userCtx = userName && userName !== 'ไม่ระบุ'
    ? `\nชื่อ user: ${userName}`
    : userName === 'ไม่ระบุ' ? '\nuser ไม่ระบุชื่อ ให้เรียกว่า "คุณ"' : ''

  const completedStr = (completed || []).length
    ? (completed || []).map(c => c.startsWith('✗') ? `  ${c}` : `  ✓ ${c}`).join('\n')
    : '  (no actions)'

  const stageCtx = `${responseGuide}

[สิ่งที่ระบบดำเนินการในรอบนี้ — เอามาประกอบคำตอบ]
${completedStr}

[stage ปัจจุบัน: ${stage}]
`

  const llm = makeLLM(settings, { temperature: 0.7 })

  const last = messages[messages.length - 1]
  const lastWithCtx = new HumanMessage({
    content: String(last?.content || '') + '\n\n' + stageCtx,
  })

  let finalMsg
  const stream = await llm.stream(
    [
      new SystemMessage(SIN_PERSONA + userCtx),
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
  console.log(`  [Onboarding Response] → ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`)

  return { messages: [finalMsg] }
}
