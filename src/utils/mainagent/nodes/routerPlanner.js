import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { knowledge_data, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt } from '../skills/index.js'

function buildPrompt(settings, kgText, lastCommand, chatSummary, pendingAnswer) {
  const examplesBlock = `[วาง plan จากคำสั่ง user → ตอบเป็น JSON]
[หมายเหตุ: <...> คือ placeholder — ต้องใช้ชื่อและ topic จาก KG จริงๆ เท่านั้น]
"สวัสดี" / ถามทั่วไป / ถามสถานะจาก KG  → {"steps":[{"type":"general"}],"needs_next_round":false}
"เปิด/ปิด device ที่มีใน KG"             → {"steps":[{"type":"home_control","device":"<ชื่อใน KG>","topic":"<topic ใน KG>","payload":"ON"}],"needs_next_round":false}
"ตั้งค่า analog device พร้อมระบุค่า"     → {"steps":[{"type":"home_control","device":"<ชื่อใน KG>","topic":"<topic ใน KG>","payload":"25"}],"needs_next_round":false}
"สั่ง hub ทำ task"                        → {"steps":[{"type":"hub_control","device":"<hub ใน KG>","topic":"<topic ใน KG>","task":"shutdown"}],"needs_next_round":false}
"ดูข้อมูล real-time"                      → {"steps":[{"type":"realtime_data","query":"ราคา BTC วันนี้"}],"needs_next_round":false}
"ถ้า [เงื่อนไข real-time] ทำ X"          → {"steps":[{"type":"realtime_data","query":"ราคา BTC ล่าสุด"}],"needs_next_round":true}
"device ที่ไม่มีใน KG"                   → {"steps":[{"type":"device_not_found","device":"<ชื่อที่ user บอก>"}],"needs_next_round":false}
"เปิด/ปิด skill หรือตั้งค่าระบบ"         → {"steps":[{"type":"settings","query":"เปิด skill web search"}],"needs_next_round":false}
"เปิด analog device แต่ไม่บอกค่า"        → {"steps":[{"type":"general","response":"จะตั้งกี่[หน่วย]ดีคะ?"}],"needs_next_round":false}
"ไม่รู้ว่าต้องการอะไร"                    → {"steps":[{"type":"general","response":"ต้องการให้ช่วยเรื่องอะไรคะ?"}],"needs_next_round":false}`

  const rulesBlock = `[กฎ]
- ใช้เฉพาะ device ที่มีใน [สถานะบ้านตอนนี้] ห้ามเดาชื่อ
- user พูดสั้นอ้างถึงของเดิม → ดู history แล้ว plan ต่อเลย ไม่ต้องถาม
- เงื่อนไขที่ยังไม่รู้ผล → ค้นข้อมูลก่อน ตั้ง needs_next_round=true`

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
  const plan = parseJSON(String(res.content || ''))

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
