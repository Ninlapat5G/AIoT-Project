import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { knowledge_data, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt } from '../skills/index.js'

function buildPrompt(settings, kgText, lastCommand, chatSummary, pendingAnswer) {
  const examplesBlock = `[วาง plan จากคำสั่ง user → ตอบเป็น JSON]

สมมติ KG มี: ไฟห้องนั่งเล่น (topic: home/light/living), แอร์ห้องนอน analog (topic: home/ac/bedroom), office-pc hub (topic: synapta/office-pc)
"สวัสดี" / ถามทั่วไป / ถามสถานะจาก KG  → {"steps":[{"type":"general"}],"needs_next_round":false}
"เปิดไฟห้องนั่งเล่น"                    → {"steps":[{"type":"home_control","device":"ไฟห้องนั่งเล่น","topic":"home/light/living","payload":"ON"}],"needs_next_round":false}
"ตั้งแอร์ 25 องศา"                       → {"steps":[{"type":"home_control","device":"แอร์ห้องนอน","topic":"home/ac/bedroom","payload":"25"}],"needs_next_round":false}
"เปิดโปรแกรม/เพลง/URL/ไฟล์/คำสั่ง"    → {"steps":[{"type":"hub_control","device":"office-pc","topic":"synapta/office-pc","task":"<คำสั่งเต็มของ user>"}],"needs_next_round":false}
"user ตอบคำถามที่ hub ถาม"              → {"steps":[{"type":"hub_control","device":"office-pc","topic":"synapta/office-pc","task":"<คำสั่งสมบูรณ์ที่รวม context เดิมเข้าไป>"}],"needs_next_round":false}
"ดูข้อมูล real-time"                    → {"steps":[{"type":"realtime_data","query":"ราคา BTC วันนี้"}],"needs_next_round":false}
"ถ้า [เงื่อนไข real-time] ทำ X"        → {"steps":[{"type":"realtime_data","query":"ราคา BTC ล่าสุด"}],"needs_next_round":true}
"device ที่ไม่มีใน KG เลย"             → {"steps":[{"type":"device_not_found","device":"<ชื่อที่ user บอก>"}],"needs_next_round":false}
"เปิด/ปิด skill หรือตั้งค่าระบบ"       → {"steps":[{"type":"settings","query":"เปิด skill web search"}],"needs_next_round":false}
"เปิด analog device แต่ไม่บอกค่า"      → {"steps":[{"type":"general","response":"จะตั้งกี่[หน่วย]ดีคะ?"}],"needs_next_round":false}

⚠️ ตัวอย่างด้านบนใช้ชื่อสมมติ — ในการตอบจริงต้องใช้ชื่อ device และ topic จาก [สถานะบ้านตอนนี้] เท่านั้น ห้ามนำชื่อในตัวอย่างมาใช้`

  const rulesBlock = `[กฎ]
- ใช้เฉพาะ device ที่มีใน [สถานะบ้านตอนนี้] ห้ามเดาชื่อ
- user พูดสั้นอ้างถึงของเดิม → ดู history แล้ว plan ต่อเลย ไม่ต้องถาม
- เงื่อนไขที่ยังไม่รู้ผล → ค้นข้อมูลก่อน ตั้ง needs_next_round=true
- งานที่เกี่ยวกับคอมพิวเตอร์ทุกอย่าง (เปิดโปรแกรม, URL, ไฟล์, command, ระบบ) → hub_control เสมอ ห้ามใช้ general/settings/realtime_data
- hub_control task ต้องสมบูรณ์เสมอ — ถ้า user กำลังตอบคำถาม hub ให้ดู history แล้วรวม context เดิมเข้าไปด้วย อย่าส่งแค่คำตอบสั้นๆ ของ user
- ถาม/เช็คสถานะ device ("...เปิดอยู่ไหม", "ตอนนี้กี่องศา", "ไฟปิดหรือเปล่า") → general เสมอ ข้อมูลอยู่ใน [สถานะบ้านตอนนี้] แล้ว ห้ามใช้ home_control
- home_control payload ต้องเป็น "ON"/"OFF" (digital) หรือตัวเลข (analog) เท่านั้น — ห้ามใส่ "get", "status", "check" หรือคำถามใดๆ เด็ดขาด`

  const contextParts = [`[สถานะบ้านตอนนี้]\n${kgText}`]
  if (chatSummary)   contextParts.push(`[สรุปบทสนทนาก่อนหน้า]\n${chatSummary}`)
  if (lastCommand)   contextParts.push(`[คำสั่งอุปกรณ์ล่าสุด]\n${lastCommand}`)
  if (pendingAnswer) contextParts.push(`[รอคำตอบจาก user]\n${pendingAnswer}\n→ ถ้า user ตอบเรื่องนี้ ใช้คำตอบนั้น plan; ถ้า user เปลี่ยนเรื่อง ทิ้งทำตามเรื่องใหม่`)

  return [
    examplesBlock,
    rulesBlock,
    contextParts.join('\n\n'),
    `[รายละเอียดเครื่องมือ]\n${buildPlanPrompt(settings)}`,
  ].join('\n\n')
}

export async function routerPlannerNode(state) {
  const t0 = Date.now()
  console.log('  [Router] start')
  const { settings, signal, lastCommand } = state
  const devices = (state.deviceList?.current ?? state.deviceList) || []
  const messages = state.messages || []

  const kgText = knowledge_data({ devices, settings, now: nowString() })
  const systemPrompt = buildPrompt(
    settings, kgText, lastCommand,
    state.chat_summary || '',
    state.pending_answer || '',
  )

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600, responseFormat: { type: 'json_object' } })

  const lastMsg = messages[messages.length - 1]
  const previousMsgs = messages.slice(0, -1)
  const msgs = [new SystemMessage(systemPrompt), ...previousMsgs, new HumanMessage(String(lastMsg?.content || ''))]

  const res = await llm.invoke(msgs, { signal })
  const lastText = String(res.content || '')
  let plan = parseJSON(lastText)

  if (!plan) {
    console.warn('  [Router] parse fail — sending as general response')
    plan = { steps: [{ type: 'general', response: lastText }] }
  }

  const nextRound = (state.router_round || 0) + 1

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

  const needsNextRound = !!plan?.needs_next_round

  console.log(`  [Router #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound} (${Date.now() - t0}ms)`)

  return {
    plan: { steps },
    needs_next_round: needsNextRound,
    router_round: nextRound,
    failed_steps: [],
    has_failed_step: false,
    lastCommand: lastCommand,
  }
}
