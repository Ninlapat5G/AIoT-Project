import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { knowledge_data, findDeviceByName } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt } from '../skills/index.js'

function buildPrompt(settings, kgText) {
  const roleBlock = `[เช็คเงื่อนไขจากผลค้น → ตอบ JSON step ถัดไป]
เงื่อนไขเข้า ไม่มีอะไรเหลือ   → plan step สั่งงาน         (needs_next_round=false)
เงื่อนไขเข้า ยังมีเงื่อนไขซ้อน → plan step ค้นข้อมูลต่อ   (needs_next_round=true)
เงื่อนไขไม่เข้า / ข้อมูล error → steps=[]                 (needs_next_round=false)`

  const examplesBlock = `[ตัวอย่าง — <...> คือ placeholder ต้องใช้ของจริงจาก KG]
user: "ถ้าหุ้น NVDA ขึ้นเปิดไฟหน้าบ้าน"  completed: ["NVDA = +5.77%"]
→ {"steps":[{"type":"home_control","device":"<ชื่อใน KG>","topic":"<topic ใน KG>","payload":"ON"}],"needs_next_round":false}

user: "ถ้า BTC เกิน 100k เช็คพยากรณ์ฝน ถ้าฝนไม่ตกเปิดไฟสนาม"  completed: ["BTC = $115k"]
→ {"steps":[{"type":"realtime_data","query":"พยากรณ์ฝนกรุงเทพ"}],"needs_next_round":true}

user: "ถ้า BTC เกิน 100k เปิดไฟ"  completed: ["BTC = $80k"]
→ {"steps":[],"needs_next_round":false}`

  const rulesBlock = `[กฎ]
- ใช้เฉพาะ device ที่มีใน [สถานะบ้านตอนนี้] ห้ามเดาชื่อ
- needs_next_round=true เฉพาะตอนยังต้องค้นข้อมูลเพื่อตัดสินใจต่อ`

  return [
    roleBlock,
    examplesBlock,
    rulesBlock,
    `[สถานะบ้านตอนนี้]\n${kgText}`,
    `[เครื่องมือที่ใช้ได้]\n${buildPlanPrompt(settings)}`,
  ].join('\n\n')
}

export async function evaluatorNode(state) {
  const t0 = Date.now()
  console.log('  [Evaluator] start')
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

  const kgText = knowledge_data({ devices, settings, now: nowString() })
  const systemPrompt = buildPrompt(settings, kgText)

  const completedBlock = completed?.length
    ? completed.map(c => `- ${c}`).join('\n')
    : '(ยังไม่มีผลค้น)'

  const input = `[user สั่งอะไรไว้]\n${userText}\n\n[ผลที่ค้นมา]\n${completedBlock}`

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600, responseFormat: { type: 'json_object' } })
  const msgs = [new SystemMessage(systemPrompt), new HumanMessage(input)]

  let plan = null
  for (let attempt = 0; attempt < 2 && !plan; attempt++) {
    const res = await llm.invoke(msgs, { signal })
    plan = parseJSON(String(res.content || ''))
    if (!plan) console.warn(`  [Evaluator] parse fail (attempt ${attempt + 1}) — ${attempt < 1 ? 'retry' : 'giving up'}`)
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
        console.log(`  [Evaluator] auto-filled topic for "${s.device}" → ${dev.topic}`)
      }
    }
  }

  const needsNextRound = !!plan?.needs_next_round

  console.log(`  [Evaluator #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound} (${Date.now() - t0}ms)`)

  return {
    plan: { steps },

    needs_next_round: needsNextRound,
    router_round: nextRound,
    failed_steps: [],
    has_failed_step: false,
  }
}
