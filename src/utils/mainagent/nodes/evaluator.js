// evaluator — ประเมินเงื่อนไข + plan step ถัดไปใน 1 LLM call
//
// แทนที่คู่ synthesizer (text) + router2 (parse text) เดิม
// รับ: user request ล่าสุด + completed (สะสม) + KG สด + tools
// พ่น: JSON schema เดียวกับ router → loop กลับเข้าตัวเองได้ผ่าน routeAfterExecutor เดิม

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { buildPlanPrompt } from '../skills/index.js'

const EVALUATOR_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: 'step ที่จะรันในรอบนี้ — ว่างถ้าตัดสินว่า "เงื่อนไขไม่ตรง" / ไม่มีอะไรต้องทำต่อ',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { type: { type: 'string' } },
        required: ['type'],
      },
    },
    needs_next_round: {
      type: 'boolean',
      description: 'true เฉพาะกรณี: รอบนี้ใส่ step ค้นข้อมูล แล้วต้องเอาผลไปตัดสินใจในรอบต่อมา (ยังเหลือเงื่อนไขในคำสั่ง user ที่ยังไม่ได้เช็ค)',
    },
  },
  required: ['steps', 'needs_next_round'],
}

function buildPrompt(settings, kgText) {
  const skillBlock = buildPlanPrompt(settings)

  const roleBlock = `[หน้าที่]
คุณคือ Evaluator — รับคำสั่งของ user + ผลข้อมูลที่ระบบค้นมาได้ → ประเมินเงื่อนไข → พ่น JSON สั่งงาน step ถัดไป

วิธีคิด (คิดในใจ ห้ามพิมพ์ออกมา):
1. แกะคำสั่ง user — มีกี่เงื่อนไข, เงื่อนไขแต่ละข้อต้องการข้อมูลอะไร
2. ดูข้อมูลใน [ผลที่ค้นมา] — มีข้อมูลครบสำหรับเช็คเงื่อนไขที่กำลังตรวจหรือยัง
3. ตัดสิน:
   (ก) เงื่อนไขนี้ "เข้า" และไม่มีเงื่อนไขอื่นรอเช็ค → plan step สั่งงาน (home_control / hub_control / ฯลฯ), needs_next_round=false
   (ข) เงื่อนไขนี้ "เข้า" แต่ยังมีเงื่อนไขอื่นต้องเช็คก่อนสั่งงาน → plan step ค้นข้อมูลของเงื่อนไขถัดไป, needs_next_round=true
   (ค) เงื่อนไขนี้ "ไม่เข้า" / ข้อมูลไม่พอ / ข้อมูล error → steps=[], needs_next_round=false (จบที่นี่ ให้ระบบไปแจ้ง user)`

  const examplesBlock = `[ตัวอย่าง]

▸ เงื่อนไขเข้า + ไม่เหลืออะไรเช็ค → สั่งงานเลย
  user: "ถ้าหุ้น NVDA ขึ้นเปิดไฟหน้าบ้าน"
  completed: ["NVDA = +5.77%"]
  → {"steps":[{"type":"home_control","device":"ไฟหน้าบ้าน",...,"payload":"ON"}],"needs_next_round":false}

▸ If-Else
  user: "ถ้าหุ้นขึ้นเปิดไฟ ถ้าลงปิดไฟ"
  completed: ["หุ้น = -4%"]
  → {"steps":[{"type":"home_control","device":"ไฟหน้าบ้าน",...,"payload":"OFF"}],"needs_next_round":false}

▸ เงื่อนไขซ้อน — เข้าเงื่อนไขแรก ยังเหลือเงื่อนไขสอง
  user: "ถ้า BTC เกิน 100k เช็คพยากรณ์ฝน ถ้าฝนไม่ตกเปิดไฟสนาม"
  completed: ["BTC = $115k"]
  → {"steps":[{"type":"realtime_data","query":"พยากรณ์ฝนกรุงเทพพรุ่งนี้"}],"needs_next_round":true}
  (เพราะเงื่อนไขแรกเข้าแล้ว แต่เงื่อนไขสองยังต้องค้นพยากรณ์ฝน)

▸ ครบทุกเงื่อนไข
  user: "ถ้า BTC เกิน 100k เช็คพยากรณ์ฝน ถ้าฝนไม่ตกเปิดไฟสนาม"
  completed: ["BTC = $115k", "พยากรณ์: ฝนไม่ตก"]
  → {"steps":[{"type":"home_control","device":"ไฟสนาม",...,"payload":"ON"}],"needs_next_round":false}

▸ ไม่เข้าเงื่อนไข
  user: "ถ้า BTC เกิน 100k เปิดไฟ"
  completed: ["BTC = $80k"]
  → {"steps":[],"needs_next_round":false}

▸ ข้อมูล error / ไม่พอ
  user: "ถ้าฝนตกบอกด้วย"
  completed: ["✗ web_search: API key หมด"]
  → {"steps":[],"needs_next_round":false}`

  const rulesBlock = `[กฎ]
- ระบุ device ที่มีอยู่จริงใน [สถานะบ้านตอนนี้] เท่านั้น ห้ามเดาชื่อ
- steps ที่พ่นต้อง match กับ [เครื่องมือที่ใช้ได้] ห้ามคิดเครื่องมือใหม่
- needs_next_round=true ต่อเมื่อ "ใส่ step ค้นข้อมูล + ต้องเอาผลไปตัดสินใจอีกรอบ" เท่านั้น ปกติ false`

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

  const kgText = snapshotText({ devices, settings, now: nowString() })
  const systemPrompt = buildPrompt(settings, kgText)

  const completedBlock = (completed?.length)
    ? completed.map(c => `- ${c}`).join('\n')
    : '(ยังไม่มีผลค้น)'

  const input = `[user สั่งอะไรไว้]
${userText}

[ผลที่ค้นมา]
${completedBlock}`

  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 600,
    structured: EVALUATOR_SCHEMA,
  })

  const nextRound = (state.router_round || 0) + 1
  const maxRounds = state.max_router_rounds || 3

  let plan
  try {
    plan = await llm.invoke(
      [new SystemMessage(systemPrompt), new HumanMessage(input)],
      { signal }
    )
  } catch (err) {
    console.warn('  [Evaluator] structured-output failed:', err?.message)
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

  let needsNextRound = !!plan?.needs_next_round
  const rawNeedsNextRound = plan?.needs_next_round
  if (nextRound >= maxRounds) needsNextRound = false  // safety cap

  console.log(`  [Evaluator #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound} (raw=${JSON.stringify(rawNeedsNextRound)})`)

  return {
    plan: { steps },
    needs_clarify: false,
    needs_next_round: needsNextRound,
    router_round: nextRound,
    failed_steps: [],
    has_failed_step: false,
  }
}
