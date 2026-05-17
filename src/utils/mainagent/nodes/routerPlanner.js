import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt } from '../skills/index.js'

function buildSystemPrompt(settings, devices, lastCommand, kgText, carryOver) {
  const skillBlock = buildPlanPrompt(settings)
  const { router_context, pending_clarify, wait_retry } = carryOver || {}

  // ── Section: หน้าที่ ────────────────────────────────────────────────────────
  const roleBlock = `[หน้าที่ของคุณ]
อ่านคำสั่งล่าสุดของ user แล้วเลือกเครื่องมือ (step) มาใช้ทำงาน ตอบกลับเป็น JSON ก้อนเดียวเท่านั้น`

  // ── Section: context ของสถานะปัจจุบัน + carry-over ─────────────────────────
  const contextParts = [`[สถานะบ้านตอนนี้]\n${kgText}`]

  if (lastCommand) {
    contextParts.push(`[อุปกรณ์ที่เพิ่งสั่งล่าสุด]\n${lastCommand}`)
  }
  if (router_context) {
    contextParts.push(
      `[ผลของรอบก่อน — turn เดียวกันนี้ คุณเพิ่งทำไปแล้ว]\n${router_context}\n→ ตอนนี้คุณอยู่รอบที่ 2 ตัดสินใจตามข้อมูลนี้ แล้วตั้ง "needs_next_round": false (จบ turn)`
    )
  }
  if (pending_clarify) {
    contextParts.push(
      `[คำถามที่คุณถาม user ไว้ใน turn ก่อน — รอคำตอบอยู่]\n${pending_clarify}\n→ ถ้า message ใหม่ของ user เหมือนตอบคำถามนี้ ใช้คำตอบไป plan task เดิม; ถ้า user เปลี่ยนเรื่อง ทิ้งคำถามนี้ทำตามเรื่องใหม่`
    )
  }
  if (wait_retry) {
    contextParts.push(
      `[งานที่ทำไม่สำเร็จใน turn ก่อน — รอ user สั่งต่อ]\n${wait_retry}\n→ ถ้า user สั่ง "ลองอีกที" / "ทำต่อ" plan งานพวกนี้; ถ้า user เปลี่ยนเรื่อง ทิ้งทำตามเรื่องใหม่`
    )
  }
  const contextBlock = contextParts.join('\n\n')

  // ── Section: เครื่องมือ ────────────────────────────────────────────────────
  const toolsBlock = `[เครื่องมือที่ใช้ได้]
${skillBlock}`

  // ── Section: กฎการตัดสินใจหลัก ────────────────────────────────────────────
  const decisionBlock = `[คิดก่อนวาง plan: รอบเดียวจบ หรือ ต้องดูข้อมูลก่อน?]
ถามตัวเอง: "ตอนนี้ฉันรู้ผลของทุก step แล้วหรือยัง?"

(ก) รู้แล้ว → ใส่ทุก step ในรอบนี้, "needs_next_round": false
    ตัวอย่าง:
      User: "เปิดไฟห้องนั่งเล่น"
      ตอบ: {"steps":[{"type":"home_control","device":"ไฟห้องนั่งเล่น",...}],"needs_next_round":false}

(ข) ยังไม่รู้ ต้องไปดึงข้อมูลก่อนค่อยตัดสินใจ → ใส่แค่ step ที่ดึงข้อมูล, "needs_next_round": true
    สัญญาณ: คำสั่งมีคำว่า "ถ้า" / "หาก" / "เผื่อ" / "ขึ้นอยู่กับ" หรือต้องดู ราคา/ข่าว/อากาศ ก่อนตัดสินใจ
    อย่าเดาผลล่วงหน้า — ปล่อยให้รอบ 2 ตัดสินใจตามข้อมูลจริง
    ตัวอย่าง:
      User: "ดูราคา BTC ถ้าเกิน 100k USD เปิดไฟห้องนอน"
      รอบ 1 ตอบ: {"steps":[{"type":"realtime_data","query":"ราคา BTC ตอนนี้ USD"}],"needs_next_round":true}
      (ห้ามใส่ home_control ในรอบนี้)

      รอบ 2 (จะมี [ผลของรอบก่อน] ใน context) ตัดสินใจอีกที:
        - เข้าเงื่อนไข → {"steps":[{"type":"home_control",...เปิดไฟห้องนอน...}],"needs_next_round":false}
        - ไม่เข้า     → {"steps":[],"needs_next_round":false}`

  // ── Section: เคสพิเศษ ──────────────────────────────────────────────────────
  const specialBlock = `[เคสอื่น ๆ]
- user พูดสั้น ("ปิดเลย", "อันนั้น", "มัน", "ด้วย", "อีกอัน") → ดู history หาว่าหมายถึงอุปกรณ์ตัวไหน แล้ว plan ต่อ ไม่ต้องถามซ้ำ
- ข้อมูลไม่พอจะ plan → ถามก่อน: {"steps":[{"type":"general","response":"คำถามสั้น ๆ"}],"needs_next_round":false}
- ตัดสินใจไม่ทำอะไรเพิ่ม → {"steps":[],"needs_next_round":false}
- ถามล้วน (โหมดเดียวกัน) → {"need_clarify":true,"question":"..."}`

  // ── Section: format ──────────────────────────────────────────────────────
  const formatBlock = `[รูปแบบคำตอบ]
ตอบเป็น JSON ก้อนเดียวเท่านั้น
ห้าม: เกริ่นนำ, markdown, code block, คำอธิบายข้าง JSON, คำว่า "รับทราบ"
ค่า value ในภาษาไทยได้ตามปกติ`

  return [
    roleBlock,
    contextBlock,
    toolsBlock,
    decisionBlock,
    specialBlock,
    formatBlock,
  ].join('\n\n')
}

export async function routerPlannerNode(state) {
  const { settings, signal, lastCommand } = state
  const devices = (state.deviceList?.current ?? state.deviceList) || []
  const messages = state.messages || []

  const kgText = snapshotText({ devices, settings, now: nowString() })
  const carryOver = {
    router_context: state.router_context || '',
    pending_clarify: state.pending_clarify || '',
    wait_retry: state.wait_retry || '',
  }
  const systemPrompt = buildSystemPrompt(settings, devices, lastCommand, kgText, carryOver)
  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  // แนบ reminder ปิดท้ายข้อความ user ล่าสุด เพื่อบังคับให้ LLM ตอบเป็น JSON ไม่หลุดไปคุยเล่น
  const lastMsg = messages[messages.length - 1]
  const previousMsgs = messages.slice(0, -1)

  const strictLastMsg = new HumanMessage(
    `${lastMsg?.content || ''}\n\n[คำเตือนจากระบบ: วิเคราะห์คำสั่งด้านบนแล้วตอบกลับเป็นโครงสร้าง JSON เท่านั้น ห้ามตอบเป็นข้อความแชทธรรมดาเด็ดขาด!]`
  )

  const msgs = [new SystemMessage(systemPrompt), ...previousMsgs, strictLastMsg]

  let plan
  try {
    const res = await llm.invoke(msgs, { signal })
    plan = parseJSON(String(res.content || ''))
  } catch {
    console.warn('  [Router] parse error → retry')
    try {
      const retry = await llm.invoke(
        [...msgs, new HumanMessage('[ระบบ: ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น]')],
        { signal }
      )
      plan = parseJSON(String(retry.content || ''))
    } catch (err2) {
      console.warn('  [Router] retry failed:', err2?.message)
      return {
        plan: null,
        needs_clarify: true,
        clarify_question: 'ขอโทษค่ะ ระบบวิเคราะห์คำสั่งสับสนนิดหน่อย ช่วยพูดใหม่อีกทีได้มั้ยคะ?',
        router_round: (state.router_round || 0) + 1,
      }
    }
  }

  const nextRound = (state.router_round || 0) + 1
  const maxRounds = state.max_router_rounds || 2

  if (plan?.need_clarify) {
    console.log(`  [Router] need_clarify → ${plan.question}`)
    return {
      plan,
      needs_clarify: true,
      clarify_question: plan.question || 'ช่วยบอกรายละเอียดเพิ่มเติมได้มั้ยคะ?',
      router_round: nextRound,
    }
  }

  const steps = Array.isArray(plan?.steps) ? plan.steps : []

  let needsNextRound = !!plan?.needs_next_round
  const rawNeedsNextRound = plan?.needs_next_round
  if (nextRound >= maxRounds) needsNextRound = false  // รอบสุดท้าย — บังคับจบ ไม่ chain

  console.log(`  [Router #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound} (raw=${JSON.stringify(rawNeedsNextRound)})`)

  return {
    plan: { steps },
    needs_clarify: false,
    needs_next_round: needsNextRound,
    router_round: nextRound,
    failed_steps: [],
    has_failed_step: false,
    lastCommand: lastCommand,
  }
}
