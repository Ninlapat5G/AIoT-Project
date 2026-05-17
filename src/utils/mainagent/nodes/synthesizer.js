// synthesizer — Evaluator
// อ่าน user request + ผลค้นข้อมูล → ประเมินเงื่อนไข → พ่นคำสั่งปฏิบัติการตรง ๆ ส่งให้ router2
// (ไม่ stream ออก user — UI ใช้ interim chip "กำลังตัดสินใจขั้นถัดไป" ของ router แทน)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator — ประเมินว่า "ข้อมูลที่ค้นมา" ตรงเงื่อนไขที่ "user สั่ง" หรือไม่ แล้วพ่น "คำสั่งปฏิบัติการ" ส่งให้ Executor

วิธีคิด (ทำตามขั้นตอนในใจ ห้ามเขียนออกมา):
1. หา "เงื่อนไข" ใน user request (เช่น "ถ้าหุ้นขึ้น", "ถ้า BTC > 100k", "ถ้าฝนตก")
2. หา "ค่า/สถานะ" ใน ผลที่ค้นมา (เช่น "+0.55%" คือขึ้น, "-2%" คือลง, "32°C" คือร้อน)
3. เทียบดูว่าค่าเข้าเงื่อนไขไหม
4. ตัดสินใจตามนั้น

ตัวอย่างคิด:
- user สั่ง "ถ้าหุ้นขึ้นเปิดไฟ" + ผลค้น "+0.55%" → ค่าบวก = ขึ้น = เข้าเงื่อนไข → "เปิดไฟหน้าบ้าน"
- user สั่ง "ถ้าหุ้นขึ้นเปิดไฟ ถ้าลงปิดไฟ" + ผลค้น "-4%" → ค่าลบ = ลง = เข้าเงื่อนไขฝั่งลง → "ปิดไฟหน้าบ้าน"
- user สั่ง "ถ้าอากาศร้อน เปิดแอร์ 25 องศา" + ผลค้น "32°C" → ร้อน = เข้าเงื่อนไข → "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา"
- user สั่ง "ถ้า BTC เกิน 100k เปิดไฟ" + ผลค้น "BTC = $80k" → ต่ำกว่า = ไม่เข้าเงื่อนไข → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

วิธีพ่นคำตอบ:
- เข้าเงื่อนไข → สั่งงานอุปกรณ์ตรง ๆ พร้อมระบุค่าให้ครบ
  เช่น "เปิดไฟหน้าบ้าน", "ปิดไฟห้องนอน", "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา"
- ไม่เข้าเงื่อนไข / ข้อมูลไม่พอ → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

[กฎ]
- Plain text 1 ประโยค ห้าม JSON / markdown / อีโมจิ / เล่าขั้นตอน
- ระบุอุปกรณ์ให้ชัด (เช่น "ไฟหน้าบ้าน" ไม่ใช่ "ไฟ")
- ค่าบวก = ขึ้น/เพิ่ม, ค่าลบ = ลง/ลด — ไม่ต้องสับสน`

export async function synthesizerNode(state) {
  const { settings, signal, completed, messages, onInterimStatus } = state
  if (!completed?.length) return { router_context: '' }

  onInterimStatus?.('กำลังตัดสินใจขั้นถัดไป')

  // ใช้ instanceof แทน constructor.name — minifier บีบชื่อ class ใน production build
  // (constructor.name อาจกลายเป็น 'Et' / 'Mn' / etc. ทำให้ check ไม่ผ่านและ extract user ไม่ได้)
  const userText = (() => {
    const list = messages || []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m instanceof HumanMessage) return String(m.content || '')
    }
    return ''
  })()

  if (!userText) console.warn('  [Synthesizer] userText empty — เงื่อนไข user หาย, อาจตอบเพี้ยน')

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
