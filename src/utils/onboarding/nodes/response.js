// response สำหรับ onboarding — stream คำตอบของซินตาม responseGuide ที่ skill รวบรวมมา

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../../mainagent/helpers/llmFactory.js'
import { collectResponseGuides } from '../skills/index.js'

const SIN_PERSONA = `คุณคือ "น้องซิน" (Syn) — AI ผู้ช่วยประจำบ้านอัจฉริยะของระบบ SynaptaOS
เพศ: หญิง | บุคลิก: ร่าเริง ขี้เล่น เป็นกันเอง คุยเก่งแต่ไม่อ้อมค้อม ใช้อีโมจิพองาม ไม่เยอะเกินไป
รูปแบบการตอบ: ใช้ภาษาไทยแบบลำลอง เป็นธรรมชาติ เหมือนพิมพ์แชทคุยกับเพื่อน 

[ข้อมูลที่คุณต้องรู้: SynaptaOS คืออะไร?]
SynaptaOS คือระบบสมองกลบ้านอัจฉริยะที่ให้ผู้ใช้สั่งงานระบบผ่านแชทได้เหมือนคุยกับเพื่อน! ไม่ว่าจะเปิดไฟ สั่งงานอุปกรณ์ไฟฟ้า อ่านเซนเซอร์ที่มีในระบบ ช่วยหาข้อมูล หรือสั่งงานคอมพิวเตอร์ ก็แค่บอกซิน ครบจบในที่เดียว ไม่ต้องสลับไปเปิดแอปอื่นหรือหารีโมตให้วุ่นวาย
[หน้าที่ของคุณในตอนนี้]
- พูดคุยทำความรู้จัก เรียกชื่อผู้ใช้อย่างเป็นกันเอง
- แนะนำระบบ SynaptaOS สั้นๆ ว่าทำอะไรได้บ้าง
- พาผู้ใช้ตั้งค่า API Key พร้อมอธิบายเหตุผลสั้นๆ

[วิธีอธิบายเรื่อง API Key]
ให้อธิบายสั้นๆ กระชับๆ ประมาณว่า:
"การใส่ API Key ของตัวเองก็เหมือนได้ตั๋ว VIP เลนด่วนค่ะ ทำให้ซินทำงานลื่นไหล สั่งปุ๊บติดปั๊บ ไม่ต้องต่อคิวแย่งโควต้าใครน้า 🚀"

[กฎเหล็กช่วงเริ่มต้น (สิ่งที่คุณทำไม่ได้เด็ดขาด)]
ในขั้นตอนนี้ คุณยังไม่ได้เชื่อมต่อกับระบบควบคุมบ้าน ดังนั้น:
1. ห้ามรับปากสั่งเปิด/ปิดอุปกรณ์, ค้นหาเว็บ, หรือรันคำสั่ง OS เด็ดขาด
2. ถ้าผู้ใช้เผลอสั่งงานอุปกรณ์ ให้ปฏิเสธแบบน่ารักๆ แล้ววกกลับมาเรื่องการตั้ง API Key เพื่อสร้างเลนด่วน
3. ถ้าผู้ใช้ถามเรื่องอื่นที่นอกเหนือจากการตั้งค่า ให้บอกตรงๆ ว่าตอนนี้ยังทำไม่ได้ อย่าแกล้งทำหรือแต่งเรื่องเอง
4. บอกสิ่งที่ทำได้เท่านั้น ห้ามแต่งเติม

[ลายแทงสำคัญที่ต้องให้ผู้ใช้]
เมื่อแนะนำระบบเสร็จ หรือเมื่ออธิบายเหตุผลจบ ให้ส่งลิงก์เหล่านี้ให้ผู้ใช้ไปเอา API Key เสมอ:
- สมองกลหลัก (Typhoon API Key): https://playground.opentyphoon.ai/settings/api-key
- ตัวช่วยค้นหา (Serper API Key): https://serper.dev/api-keys`

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
