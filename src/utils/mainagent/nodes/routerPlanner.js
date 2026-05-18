import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt, SKILLS } from '../skills/index.js'

const ALLOWED_STEP_TYPES = Object.keys(SKILLS)

function buildPrompt(settings, kgText, lastCommand, chatSummary, pendingAnswer) {
  const roleBlock = `[หน้าที่ของคุณ]
ดูคำสั่ง user แล้วเลือก step ที่ถูกต้อง ตอบเป็น JSON เท่านั้น ห้ามพิมพ์ข้อความอื่นนอกจาก JSON`

  const examplesBlock = `[ตัวอย่างทุกเคส — จำรูปแบบ JSON นี้]

▸ บทสนทนาทั่วไป / ถามความรู้ / ถามเวลา / ถามสถานะที่ตอบได้จาก KG เลย:
  "สวัสดี"                    → {"steps":[{"type":"general"}],"needs_next_round":false}
  "ตอนนี้กี่โมง"               → {"steps":[{"type":"general"}],"needs_next_round":false}
  "อุณหภูมิห้องตอนนี้เท่าไหร่"  → {"steps":[{"type":"general"}],"needs_next_round":false}
  "ไฟห้องนั่งเล่นเปิดอยู่ไหม"  → {"steps":[{"type":"general"}],"needs_next_round":false}

▸ สั่งอุปกรณ์ (digital ON/OFF):
  "เปิดไฟห้องนั่งเล่น" → {"steps":[{"type":"home_control","device":"ไฟห้องนั่งเล่น","topic":"living-room/lamp","payload":"ON"}],"needs_next_round":false}
  "ปิดพัดลม"          → {"steps":[{"type":"home_control","device":"พัดลม","topic":"fan/main","payload":"OFF"}],"needs_next_round":false}

▸ สั่งอุปกรณ์ (analog ตัวเลข):
  "ตั้งแอร์ 25 องศา"  → {"steps":[{"type":"home_control","device":"แอร์ห้องนอน","topic":"bedroom/ac","payload":"25"}],"needs_next_round":false}
  "หรี่ไฟลง 20"       → {"steps":[{"type":"home_control","device":"ไฟหรี่","topic":"dim/main","payload":"20"}],"needs_next_round":false}

▸ สั่งหลายอุปกรณ์พร้อมกัน:
  "ปิดไฟทุกห้อง" → {"steps":[{"type":"home_control","device":"ไฟห้องนั่งเล่น","topic":"...","payload":"OFF"},{"type":"home_control","device":"ไฟห้องนอน","topic":"...","payload":"OFF"}],"needs_next_round":false}

▸ สั่ง hub (คอมพิวเตอร์/Pi ที่มี agent):
  "shutdown คอม"     → {"steps":[{"type":"hub_control","device":"Main Hub","topic":"hub/main","task":"shutdown"}],"needs_next_round":false}
  "เช็ค CPU usage"   → {"steps":[{"type":"hub_control","device":"Main Hub","topic":"hub/main","task":"เช็ค CPU usage"}],"needs_next_round":false}

▸ ค้นข้อมูล real-time หรือ user สั่งให้ค้นโดยตรง (ราคา/ข่าว/สภาพอากาศ/เหตุการณ์ปัจจุบัน):
  "ราคา BTC วันนี้เท่าไหร่"   → {"steps":[{"type":"realtime_data","query":"ราคา BTC วันนี้"}],"needs_next_round":false}
  "ข่าวหุ้น NVDA ล่าสุด"      → {"steps":[{"type":"realtime_data","query":"ข่าวหุ้น NVDA ล่าสุด"}],"needs_next_round":false}
  "ค้นหาให้หน่อย xxx"         → {"steps":[{"type":"realtime_data","query":"xxx"}],"needs_next_round":false}
  ห้าม: ความรู้ทั่วไปที่ไม่ต้อง real-time → ใช้ general แทน
  เช่น "ไข้หวัดเกิดจากอะไร" / "เมืองหลวงฝรั่งเศสคือ" → {"steps":[{"type":"general"}],"needs_next_round":false}

▸ ค้นข้อมูลก่อน แล้วค่อยตัดสินใจสั่งอุปกรณ์ (ต้องรอผล):
  "ถ้า BTC เกิน 100k เปิดไฟ" → {"steps":[{"type":"realtime_data","query":"ราคา BTC ล่าสุด USD"}],"needs_next_round":true}
  (ห้ามใส่ home_control ในรอบนี้ — รอบ 2 จะตัดสินใจจากผลค้นจริง)

▸ อุปกรณ์ที่ user พูดถึงไม่มีใน KG:
  "เปิดทีวี" (ไม่มีในระบบ) → {"steps":[{"type":"device_not_found","device":"ทีวี"}],"needs_next_round":false}

▸ จัดการ settings / เปิด-ปิด skill:
  "เปิด web search"           → {"steps":[{"type":"settings","query":"เปิด skill web search"}],"needs_next_round":false}
  "web search ใช้งานยังไง"    → {"steps":[{"type":"settings","query":"web search ใช้งานยังไง"}],"needs_next_round":false}

▸ ข้อมูลไม่พอจะสั่งได้ (ถามก่อน):
  "เปิดแอร์" (ไม่บอกอุณหภูมิ) → {"steps":[{"type":"general","response":"จะให้ตั้งกี่องศาดีคะ?"}],"needs_next_round":false}

▸ user พูดสั้นอ้างถึงของเดิม — ดู history หาว่าหมายถึงอะไรแล้ว plan ต่อเลย ไม่ต้องถาม:
  "ปิดเลย" / "อันนั้น" / "ด้วย"  → plan จาก context ที่มีอยู่

▸ ถาม user ตรงๆ (ไม่มี step):
  "ช่วยได้ไหม" → {"need_clarify":true,"question":"ต้องการให้ช่วยเรื่องอะไรคะ?"}`

  const contextParts = [`[สถานะบ้านตอนนี้]\n${kgText}`]
  if (chatSummary)   contextParts.push(`[สรุปบทสนทนาก่อนหน้า]\n${chatSummary}`)
  if (lastCommand)   contextParts.push(`[คำสั่งอุปกรณ์ล่าสุด]\n${lastCommand}`)
  if (pendingAnswer) contextParts.push(
    `[รอคำตอบจาก user]\n${pendingAnswer}\n→ ถ้า user ตอบเรื่องนี้ → ใช้คำตอบไป plan; ถ้า user เปลี่ยนเรื่อง → ทิ้งทำตามเรื่องใหม่`
  )
  const contextBlock = contextParts.join('\n\n')

  const toolsBlock = `[รายละเอียดเครื่องมือ]\n${buildPlanPrompt(settings)}`

  return [roleBlock, examplesBlock, contextBlock, toolsBlock].join('\n\n')
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
