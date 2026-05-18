import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt, SKILLS } from '../skills/index.js'

const ALLOWED_STEP_TYPES = Object.keys(SKILLS)

function buildPrompt(settings, kgText, lastCommand, chatSummary, pendingAnswer) {
  const roleBlock = `[หน้าที่ของคุณ]
อ่านคำสั่งล่าสุดของ user แล้วเลือกเครื่องมือ (step) มาใช้ทำงาน
ตอบกลับเป็น JSON ก้อนเดียวเท่านั้น ห้ามพิมพ์ข้อความอื่นใดนอกจาก JSON แม้รู้คำตอบแล้วก็ตาม`

  const contextParts = [`[สถานะบ้านตอนนี้]\n${kgText}`]
  if (chatSummary)   contextParts.push(`[สรุปบทสนทนาก่อนหน้า]\n${chatSummary}`)
  if (lastCommand)   contextParts.push(`[คำสั่งอุปกรณ์ล่าสุด]\n${lastCommand}`)
  if (pendingAnswer) contextParts.push(
    `[รอคำตอบจาก user]\n${pendingAnswer}\n→ ถ้า user ตอบเรื่องนี้ → ใช้คำตอบไป plan; ถ้า user เปลี่ยนเรื่อง → ทิ้งทำตามเรื่องใหม่`
  )
  const contextBlock = contextParts.join('\n\n')

  const toolsBlock = `[เครื่องมือที่ใช้ได้]\n${buildPlanPrompt(settings)}`

  const decisionBlock = `[คิดก่อนวาง plan: รอบเดียวจบ หรือ ต้องค้นหาข้อมูลก่อนแล้วค่อยทำ?]
เกณฑ์เดียว:
"งานนี้มี step ที่ต้องค้นหา/ดึงข้อมูล แล้วเอาผลของมันไปตัดสินใจ step ถัดไป ไหม?"

(ก) ไม่มี — รู้ทุกอย่างจาก KG ปัจจุบันแล้ว → ใส่ทุก step ในรอบนี้, "needs_next_round": false
    ตัวอย่าง:
      User: "เปิดไฟห้องนั่งเล่น"
      ตอบ: {"steps":[{"type":"home_control","device":"ไฟห้องนั่งเล่น",...}],"needs_next_round":false}

(ข) มี — ต้องค้นหาข้อมูลก่อน แล้วค่อยเอาผลไปทำขั้นต่อไป → รอบนี้ใส่แค่ step ค้นหา, "needs_next_round": true
    อย่าเดาผลล่วงหน้าแล้ว plan step ถัดไปในรอบเดียวกัน
    ปล่อยให้รอบ 2 (ซึ่งจะได้ผลค้นจริงมาดู) เป็นคนตัดสินใจ
    ตัวอย่าง:
      User: "ดูราคา BTC ถ้าเกิน 100k USD เปิดไฟห้องนอน"
      → มี step ค้นราคา BTC ที่ผลของมันใช้ตัดสินใจว่าจะเปิดไฟไหม → เข้าเคส (ข)
      ตอบ: {"steps":[{"type":"realtime_data","query":"ราคา BTC ตอนนี้ USD"}],"needs_next_round":true}
      (ห้ามใส่ home_control ในรอบนี้)`

  const specialBlock = `[เคสอื่น ๆ]
- user ถามความรู้ คุยทั่วไป หรือถามข้อมูลที่ตอบได้เลยจาก KG → {"steps":[{"type":"general"}],"needs_next_round":false}
- user พูดสั้น ("ปิดเลย", "อันนั้น", "มัน", "ด้วย", "อีกอัน") → ดู history หาว่าหมายถึงอุปกรณ์ตัวไหน แล้ว plan ต่อ ไม่ต้องถามซ้ำ
- ข้อมูลไม่พอจะ plan → ถามก่อน: {"steps":[{"type":"general","response":"คำถามสั้น ๆ"}],"needs_next_round":false}
- ตัดสินใจไม่ทำอะไรเพิ่ม → {"steps":[],"needs_next_round":false}
- ถามล้วน (โหมดเดียวกัน) → {"need_clarify":true,"question":"..."}`

  return [roleBlock, contextBlock, toolsBlock, decisionBlock, specialBlock].join('\n\n')
}

export async function routerPlannerNode(state) {
  const { settings, signal, lastCommand } = state
  const devices = (state.deviceList?.current ?? state.deviceList) || []
  const messages = state.messages || []

  const kgText = snapshotText({ devices, settings, now: nowString() })
  const systemPrompt = buildPrompt(
    settings, kgText, lastCommand,
    state.chat_summary || '',
    state.pending_answer || '',
  )

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  const lastMsg = messages[messages.length - 1]
  const previousMsgs = messages.slice(0, -1)
  const msgs = [new SystemMessage(systemPrompt), ...previousMsgs, new HumanMessage(String(lastMsg?.content || ''))]

  let plan
  try {
    const res = await llm.invoke(msgs, { signal })
    plan = parseJSON(String(res.content || ''))
  } catch (err) {
    console.warn('  [Router] failed to parse plan, falling back to general:', err?.message)
    return {
      plan: { steps: [{ type: 'general' }] },
      needs_clarify: false,
      needs_next_round: false,
      router_round: (state.router_round || 0) + 1,
    }
  }

  const nextRound = (state.router_round || 0) + 1
  const maxRounds = state.max_router_rounds || 3

  if (plan?.need_clarify) {
    console.log(`  [Router] need_clarify → ${plan.question}`)
    return {
      plan,
      needs_clarify: true,
      clarify_question: plan.question || 'ช่วยบอกรายละเอียดเพิ่มเติมได้มั้ยคะ?',
      router_round: nextRound,
    }
  }

  // filter step ที่ Typhoon บางทีพ่น null / object ว่าง / ไม่มี type ออกทิ้ง
  const steps = Array.isArray(plan?.steps)
    ? plan.steps.filter(s => s && typeof s === 'object' && typeof s.type === 'string')
    : []

  // เติม topic ให้ home_control step ที่ LLM ลืมใส่ — lookup ด้วย device name จาก KG
  for (const s of steps) {
    if (s.type === 'home_control' && !s.topic && s.device) {
      const dev = findDeviceByName(devices, s.device)
      if (dev?.topic) {
        s.topic = dev.topic
        console.log(`  [Router] auto-filled topic for "${s.device}" → ${dev.topic}`)
      }
    }
  }

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
