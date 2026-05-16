// extract_name — ดึงชื่อจากข้อความ user (LLM sub-agent)
// ผลลัพธ์: state.userName + stage='setup' ถ้าได้ชื่อหรือ user ปฏิเสธ

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../../mainagent/helpers/llmFactory.js'

function isHuman(m) {
  return m instanceof HumanMessage || m?._getType?.() === 'human'
}

const NAME_SAVER_PROMPT = `วิเคราะห์ข้อความจาก user แล้วตอบ JSON:
- name: เฉพาะคำที่เป็น "ชื่อ" คำเดียวเท่านั้น ห้ามใส่คำอื่นใดๆ (string ว่างถ้าไม่ใช่ชื่อชัดเจน)
- refused: true เฉพาะเมื่อ user ปฏิเสธชัดเจน เช่น "ไม่บอก" "ไม่อยากบอก" "ไม่ต้องเรียกชื่อ"

กฎสำคัญสำหรับ field "name":
- ใส่เฉพาะตัวชื่อล้วนๆ ห้ามมีคำว่า "ชื่อ" "เรียก" "ก็ได้" ห้ามมี quote ห้ามมีคำบรรยาย ห้ามมีอีโมจิ
- ตัวอย่าง mapping:
  • "เรียกว่า ประหยัด ก็ได้" → name="ประหยัด"
  • "ชื่อสมชาย" → name="สมชาย"
  • "ฉันชื่อบิน" → name="บิน"
  • "Sarah ค่ะ" → name="Sarah"
  • "ทำไรได้บ้าง" "เธอชื่ออะไร" "สวัสดี" "อืม" → name=""
- ตอบเฉพาะตามข้อความล่าสุด ไม่ต้องเดา`

export const extractName = {
  type: 'extract_name',

  planPrompt: `extract_name — ดึงชื่อ user จากข้อความล่าสุด
ใช้เมื่อ:
- stage = "intro"
- user เพิ่งตอบเรื่องชื่อ (เช่นพิมพ์ชื่อมา หรือปฏิเสธไม่บอก)`,

  example: `{"type": "extract_name"}`,

  responseGuide: `[ขั้นตอน: ตอบ user ต่อจากครั้งก่อน — ห้ามเริ่มด้วยทักทายซ้ำ]
อ่าน [สิ่งที่ดำเนินการ] ก่อนเสมอ:
- ถ้า summary บอก "บันทึกชื่อ ..." → ขอบคุณสั้นๆ ใช้ชื่อนั้น แล้วเริ่มอธิบาย API key
- ถ้า summary บอก "user ไม่ระบุชื่อ" → บอกว่าจะเรียก "คุณ" แล้วเดินหน้าต่อ
- ถ้า summary บอก "ยังไม่มีชื่อชัดเจน — ถามต่อ":
    → user อาจจะถามคำถามแทนที่จะตอบชื่อ
    → ตอบคำถาม user ก่อน (ดู user message ล่าสุด)
    → จบประโยคด้วยการขอชื่ออีกครั้งแบบเป็นธรรมชาติ (เช่น "...ว่าแต่ ยังไม่ได้รู้จักชื่อกันเลยน้า เรียกว่าอะไรดีคะ?")
    → ห้ามทักทายซ้ำ ห้ามแนะนำตัวซ้ำ`,

  async execute(step, ctx) {
    const { settings, signal, messages } = ctx

    const lastHuman = [...(messages || [])].reverse().find(isHuman)
    if (!lastHuman) return { ok: false, summary: 'ไม่มีข้อความ user' }

    const llm = makeLLM(settings, {
      maxTokens: 30,
      structured: {
        type: 'object',
        properties: {
          name:    { type: 'string', description: 'เฉพาะตัวชื่อล้วนๆ ไม่เกิน 30 ตัวอักษร ไม่มีคำว่า "ชื่อ"/"เรียก" ไม่มี quote' },
          refused: { type: 'boolean' },
        },
        required: ['name', 'refused'],
      },
    })

    try {
      const res = await llm.invoke(
        [new SystemMessage(NAME_SAVER_PROMPT), new HumanMessage(String(lastHuman.content))],
        { signal }
      )
      if (res.name?.trim()) {
        return {
          ok: true,
          summary: `บันทึกชื่อ "${res.name.trim()}"`,
          stateUpdate: { userName: res.name.trim(), stage: 'setup' },
        }
      }
      if (res.refused) {
        return {
          ok: true,
          summary: 'user ไม่ระบุชื่อ — เรียก "คุณ"',
          stateUpdate: { userName: 'ไม่ระบุ', stage: 'setup' },
        }
      }
      return { ok: true, summary: 'ยังไม่มีชื่อชัดเจน — ถามต่อ' }
    } catch (err) {
      return { ok: false, summary: `extract_name ล้มเหลว: ${err.message}` }
    }
  },

  label() { return 'จับชื่อ user' },
}
