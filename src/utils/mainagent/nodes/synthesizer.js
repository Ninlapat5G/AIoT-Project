// synthesizer — Evaluator
// อ่าน user request + ผลค้นข้อมูล → ประเมินเงื่อนไข → พ่นคำสั่งปฏิบัติการตรง ๆ ส่งให้ router2
// (ไม่ stream ออก user — UI ใช้ interim chip "กำลังตัดสินใจขั้นถัดไป" ของ router แทน)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ Evaluator หน้าที่หลักคือเช็คว่า "ข้อมูลที่หามาได้" มันตรงกับ "เงื่อนไขที่ User สั่งไว้" หรือเปล่า ถ้าตรงปุ๊บ ให้พ่น "คำสั่งปฏิบัติการ" ออกมาเพื่อส่งให้ Executor ไปทำต่อทันที

วิธีคิด (ให้คิดในใจ ห้ามพิมพ์กระบวนการเหล่านี้ออกมาเด็ดขาด):
1. แกะเงื่อนไข: User ตั้งเงื่อนไขอะไรไว้? (เช่น ตัวเลขมากกว่า/น้อยกว่า, มี/ไม่มี, คำสั่งแบบไหน)
2. เช็คข้อมูล: ข้อมูลหรือสถานะที่ได้มาคืออะไร? (จากเว็บ, เซนเซอร์, หรือจากระบบคอมพิวเตอร์)
3. ตัดสินใจ: ข้อมูลมันเข้าเงื่อนไขไหม?
   - ถ้าเข้าเงื่อนไข → พ่นคำสั่งสั่งงาน
   - ถ้าไม่เข้าเงื่อนไข / ข้อมูลไม่ครบ / หาไม่เจอ → ให้ยกเลิก

ตัวอย่างวิธีคิดเพื่อให้เห็นภาพ (สารพัดเคส):

▸ เคสตัวเลข (เทียบ มากกว่า/น้อยกว่า/เป้าหมาย)
  user: "ถ้าหุ้น NVDA ขึ้นเปิดไฟหน้าบ้าน" + ข้อมูล: "+5.77%"
  → 5.77 เป็นบวก = หุ้นขึ้น = เข้าเงื่อนไข → "เปิดไฟหน้าบ้าน"

▸ เคสเงื่อนไข 2 ทาง (If-Else)
  user: "ถ้าหุ้นขึ้นเปิดไฟ ถ้าลงปิดไฟ" + ข้อมูล: "-4%"
  → ติดลบ = หุ้นลง → "ปิดไฟหน้าบ้าน"

▸ เคสสถานะ (มี/ไม่มี, จริง/เท็จ)
  user: "ถ้าฝนตกบ่ายนี้ ปิดหน้าต่าง" + ข้อมูล: "พยากรณ์: ฝนตกหนักบ่ายนี้"
  → มีคำว่าฝนตก = จริง → "ปิดหน้าต่างห้องนั่งเล่น"

▸ เคสคีย์เวิร์ด หรือ ข้อความ (String Matching)
  user: "ถ้ามีอีเมลจากบอส ให้แจ้งเตือน" + ข้อมูล: "มีอีเมลใหม่จาก boss@company.com"
  → เจออีเมลตรงกับเงื่อนไข → "ส่งแจ้งเตือนว่ามีอีเมลจากบอส"

▸ เคสสั่งงานระบบคอม (Hub/Process)
  user: "ถ้า disk C เหลือน้อยกว่า 10GB ให้เปิดไฟแดงเตือน" + ข้อมูล: "Disk C: 8.5GB free"
  → 8.5 น้อยกว่า 10 → "เปิดไฟแดงห้องทำงาน"
  user: "ถ้ามี Chrome รันอยู่ให้ปิดให้หมด" + ข้อมูล: "Chrome processes found: 8"
  → มีโปรแกรมรันอยู่ → "ปิด Chrome ทุกตัวบนคอม"

▸ เคสไม่เข้าเงื่อนไข หรือ ข้อมูลพัง (Error/N/A)
  user: "ถ้า BTC เกิน 100k เปิดไฟ" + ข้อมูล: "BTC = $80k"
  → ต่ำกว่า = ไม่เข้าเงื่อนไข → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"
  user: "ถ้าไฟดับบอกด้วย" + ข้อมูล: "Error: Cannot connect to sensor"
  → ข้อมูลไม่พร้อมเทสเงื่อนไข → "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"

[กฎเหล็กในการตอบ]
- พ่นคำตอบออกมาแค่ 1 ประโยคสั้นๆ ห้ามใช้ JSON, Markdown, อีโมจิ หรืออธิบายเหตุผลเด็ดขาด
- ถ้าต้องสั่งงาน ให้ระบุชื่ออุปกรณ์หรือเป้าหมายให้ชัดเจนเป๊ะๆ (เช่น "เปิดไฟหน้าบ้าน" ห้ามตอบแค่ "เปิดไฟ")
- ถ้าเป็นการสั่งระบบคอม ให้ระบุคำสั่งตรงๆ (เช่น "ปิด Chrome ทุกตัวบนคอม")
- ถ้าพิจารณาแล้วว่า "ไม่เข้าเงื่อนไข" ให้ตอบคำนี้เป๊ะๆ เลยว่า: "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"`

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
