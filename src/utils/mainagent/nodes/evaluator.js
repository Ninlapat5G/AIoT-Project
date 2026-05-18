// evaluator — ประเมินเงื่อนไข + plan step ถัดไปใน 1 LLM call
//
// แทนที่คู่ synthesizer (text) + router2 (parse text) เดิม
// รับ: user request ล่าสุด + completed (สะสม) + KG สด + tools
// พ่น: JSON schema เดียวกับ router → loop กลับเข้าตัวเองได้ผ่าน routeAfterExecutor เดิม

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotData, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt, SKILLS } from '../skills/index.js'

const ALLOWED_STEP_TYPES = Object.keys(SKILLS)

function buildPrompt(settings, kgText) {
  const skillBlock = buildPlanPrompt(settings)

  const roleBlock = `[บทบาท]
รับคำสั่ง user + ผลข้อมูลที่ค้นมา → เช็คเงื่อนไข → พ่น JSON step ถัดไป ตอบ JSON เท่านั้น

วิธีคิด (ห้ามพิมพ์ออกมา):
1. user สั่งอะไร มีเงื่อนไขกี่ข้อ
2. [ผลที่ค้นมา] มีข้อมูลครบสำหรับเช็คเงื่อนไขนั้นหรือยัง
3. ตัดสิน:
   • เงื่อนไขเข้า ไม่มีอะไรเหลือ → plan step สั่งงาน, needs_next_round=false
   • เงื่อนไขเข้า แต่ยังมีเงื่อนไขถัดไป → plan step ค้นข้อมูล, needs_next_round=true
   • เงื่อนไขไม่เข้า / ข้อมูล error → steps=[], needs_next_round=false`

  const examplesBlock = `[ตัวอย่าง]

▸ เงื่อนไขเข้า → สั่งงานเลย
  user: "ถ้าหุ้น NVDA ขึ้นเปิดไฟหน้าบ้าน"
  completed: ["NVDA = +5.77%"]
  → {"steps":[{"type":"home_control","device":"ไฟหน้าบ้าน",...,"payload":"ON"}],"needs_next_round":false}

▸ เงื่อนไขซ้อน — ยังต้องค้นข้อมูลอีกรอบ
  user: "ถ้า BTC เกิน 100k เช็คพยากรณ์ฝน ถ้าฝนไม่ตกเปิดไฟสนาม"
  completed: ["BTC = $115k"]
  → {"steps":[{"type":"realtime_data","query":"พยากรณ์ฝนกรุงเทพ"}],"needs_next_round":true}

▸ ไม่เข้าเงื่อนไข / ข้อมูล error
  user: "ถ้า BTC เกิน 100k เปิดไฟ"
  completed: ["BTC = $80k"]
  → {"steps":[],"needs_next_round":false}`

  const rulesBlock = `[กฎ]
- ใช้เฉพาะ device ที่มีใน [สถานะบ้านตอนนี้] ห้ามเดาชื่อ
- needs_next_round=true ต่อเมื่อใส่ step ค้นข้อมูลที่ต้องเอาผลมาตัดสินใจต่อเท่านั้น`

  const kgBlock = `[สถานะบ้านตอนนี้]
${kgText}`

  const toolsBlock = `[เครื่องมือที่ใช้ได้]
${skillBlock}`

  return [roleBlock, examplesBlock, rulesBlock, kgBlock, toolsBlock].join('\n\n')
}

export async function evaluatorNode(state) {
  const { settings, signal, completed, messages, onInterimStatus } = state
  const devices = (state.deviceList?.current ?? state.deviceList) || []

  onInterimStatus?.('กำลังตัดสินใจขั้นถัดไป')

  // หา user message ล่าสุด (ใช้ instanceof — minifier บีบชื่อ class ได้)
  const userText = (() => {
    const list = messages || []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (m instanceof HumanMessage) return String(m.content || '')
    }
    return ''
  })()

  if (!userText) console.warn('  [Evaluator] userText empty — เงื่อนไข user หาย')

  const kgText = snapshotData({ devices, settings, now: nowString() })
  const systemPrompt = buildPrompt(settings, kgText)

  const completedBlock = (completed?.length)
    ? completed.map(c => `- ${c}`).join('\n')
    : '(ยังไม่มีผลค้น)'

  const input = `[user สั่งอะไรไว้]
${userText}

[ผลที่ค้นมา]
${completedBlock}`

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  const nextRound = (state.router_round || 0) + 1
  const maxRounds = state.max_router_rounds || 3

  let plan
  try {
    const res = await llm.invoke(
      [new SystemMessage(systemPrompt), new HumanMessage(input)],
      { signal }
    )
    plan = parseJSON(String(res.content || ''))
  } catch (err) {
    console.warn('  [Evaluator] failed to parse plan:', err?.message)
    return {
      plan: { steps: [] },
      needs_next_round: false,
      router_round: nextRound,
      failed_steps: [],
      has_failed_step: false,
    }
  }

  const steps = Array.isArray(plan?.steps)
    ? plan.steps.filter(s => s && typeof s === 'object' && typeof s.type === 'string')
    : []

  // เติม topic ให้ home_control step ที่ LLM ลืมใส่ — lookup ด้วย device name จาก KG
  for (const s of steps) {
    if (s.type === 'home_control' && !s.topic && s.device) {
      const dev = findDeviceByName(devices, s.device)
      if (dev?.topic) {
        s.topic = dev.topic
        console.log(`  [Evaluator] auto-filled topic for "${s.device}" → ${dev.topic}`)
      }
    }
  }

  let needsNextRound = !!plan?.needs_next_round
  if (nextRound >= maxRounds) needsNextRound = false

  console.log(`  [Evaluator #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound} (raw=${JSON.stringify(plan?.needs_next_round)})`)

  return {
    plan: { steps },
    needs_clarify: false,
    needs_next_round: needsNextRound,
    router_round: nextRound,
    failed_steps: [],
    has_failed_step: false,
  }
}
