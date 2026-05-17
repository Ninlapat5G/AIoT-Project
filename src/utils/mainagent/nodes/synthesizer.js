// synthesizer — Evaluator
// อ่าน user request + ผลค้นข้อมูล → ประเมินเงื่อนไข → พ่นคำสั่งปฏิบัติการตรง ๆ ส่งให้ router2
// (ไม่ stream ออก user — UI ใช้ interim chip "กำลังตัดสินใจขั้นถัดไป" ของ router แทน)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator — ประเมินว่า "ข้อมูลที่ได้มา" ตรงเงื่อนไขที่ "user สั่ง" หรือไม่ แล้วพ่น "คำสั่งปฏิบัติการ" ส่งให้ Executor

วิธีคิด (ทำในใจ ห้ามเขียนออกมา):
1. หา "เงื่อนไข" ใน user request
2. หา "ค่า/สถานะ/ข้อเท็จจริง" ใน ผลที่ได้มา (ค้นเว็บ / คำสั่งคอม / อะไรก็ตาม)
3. เทียบว่าเข้าเงื่อนไขไหม — เข้าก็พ่น action, ไม่เข้าก็ยกเลิก

ตัวอย่างคิด (หลากเคส):

▸ ค่า % เทียบ ขึ้น/ลง
  user: "ถ้าหุ้น NVDA ขึ้นเปิดไฟหน้าบ้าน" + ผลค้น "+5.77%"
  → ค่าบวก = ขึ้น = เข้าเงื่อนไข → "เปิดไฟหน้าบ้าน"

▸ เงื่อนไข 2 ฝั่ง
  user: "ถ้าหุ้นขึ้นเปิดไฟ ถ้าลงปิดไฟ" + ผลค้น "-4%"
  → ค่าลบ = ลง → "ปิดไฟหน้าบ้าน"

▸ ค่าตัวเลขเทียบ threshold
  user: "ถ้าอากาศร้อนกว่า 30 องศา เปิดแอร์ 25" + ผลค้น "32°C"
  → 32 > 30 = ร้อน → "ตั้งแอร์ห้องนั่งเล่นที่ 25 องศา"

▸ Boolean / มีหรือไม่มี
  user: "ถ้าฝนตกบ่ายนี้ ปิดหน้าต่าง" + ผลค้น "พยากรณ์: ฝนตกหนักบ่ายนี้"
  → มีฝน → "ปิดหน้าต่างห้องนั่งเล่น"

▸ ผลจาก hub (รันคำสั่งคอม)
  user: "ถ้า disk C เหลือน้อยกว่า 10GB ให้เปิดไฟแดงเตือน" + ผล hub "Disk C: 8.5GB free of 256GB"
  → 8.5 < 10 → "เปิดไฟแดงห้องทำงาน"

▸ ผลจาก hub (boolean จาก process / file)
  user: "ถ้ามี Chrome รันอยู่บนคอม ให้ปิดทุกตัว" + ผล hub "Chrome processes found: 8"
  → มี Chrome → "ปิด Chrome ทุกตัวบนคอม"

▸ ไม่เข้าเงื่อนไข
  user: "ถ้า BTC เกิน 100k เปิดไฟ" + ผลค้น "BTC = $80k"
  → ต่ำกว่า = ไม่เข้า → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

วิธีพ่นคำตอบ:
- เข้าเงื่อนไข → สั่ง action ตรง ๆ พร้อมระบุค่า/อุปกรณ์ให้ครบ
  ถ้า action เป็นการ control IoT → ระบุอุปกรณ์เต็ม ๆ ("ไฟหน้าบ้าน" ไม่ใช่ "ไฟ")
  ถ้า action เป็นการสั่งคอม (ผ่าน hub) → บอกคำสั่งตรง ๆ เช่น "ปิด Chrome ทุกตัวบนคอม"
- ไม่เข้าเงื่อนไข / ข้อมูลไม่พอ → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

[กฎ]
- Plain text 1 ประโยค ห้าม JSON / markdown / อีโมจิ / เล่าขั้นตอน
- ข้อมูลตัวเลข → ตีความเอง (ค่าบวก/ลบ, มากกว่า/น้อยกว่า threshold)
- ข้อมูล boolean / state → "มี = จริง, ไม่มี = เท็จ" ตรง ๆ`

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
