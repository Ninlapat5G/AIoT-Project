import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { buildPlanPrompt } from '../skills/index.js'

// JSON schema บังคับให้ LLM ต้อง commit needs_next_round ทุกครั้ง — กัน Typhoon ลืมใส่ field
const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: 'รายการ step ที่ต้องทำในรอบนี้ — อาจเป็น array ว่างถ้าตัดสินใจไม่ทำอะไร',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { type: { type: 'string' } },
        required: ['type'],
      },
    },
    needs_next_round: {
      type: 'boolean',
      description: 'true เฉพาะกรณี: รอบนี้มี step ดึงข้อมูล แล้วต้องเอาผลไปตัดสินใจ step ถัดไปในรอบต่อมา ปกติให้ false',
    },
    need_clarify: {
      type: 'boolean',
      description: 'true ถ้าจะถาม user ล้วน ๆ ไม่ทำอะไร (ใช้แทน steps)',
    },
    question: {
      type: 'string',
      description: 'คำถาม clarify (ใช้คู่กับ need_clarify=true)',
    },
  },
  required: ['steps', 'needs_next_round'],
}

function buildRoundOnePrompt(settings, lastCommand, kgText, pending_clarify, wait_retry) {
  const skillBlock = buildPlanPrompt(settings)

  const roleBlock = `[หน้าที่ของคุณ]
อ่านคำสั่งล่าสุดของ user แล้วเลือกเครื่องมือ (step) มาใช้ทำงาน ตอบกลับเป็น JSON ก้อนเดียว`

  const contextParts = [`[สถานะบ้านตอนนี้]\n${kgText}`]
  if (lastCommand) {
    contextParts.push(`[อุปกรณ์ที่เพิ่งสั่งล่าสุด]\n${lastCommand}`)
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

  const toolsBlock = `[เครื่องมือที่ใช้ได้]\n${skillBlock}`

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
- user พูดสั้น ("ปิดเลย", "อันนั้น", "มัน", "ด้วย", "อีกอัน") → ดู history หาว่าหมายถึงอุปกรณ์ตัวไหน แล้ว plan ต่อ ไม่ต้องถามซ้ำ
- ข้อมูลไม่พอจะ plan → ถามก่อน: {"steps":[{"type":"general","response":"คำถามสั้น ๆ"}],"needs_next_round":false}
- ตัดสินใจไม่ทำอะไรเพิ่ม → {"steps":[],"needs_next_round":false}
- ถามล้วน (โหมดเดียวกัน) → {"need_clarify":true,"question":"..."}`

  return [roleBlock, contextBlock, toolsBlock, decisionBlock, specialBlock].join('\n\n')
}

function buildRoundTwoPrompt(settings, kgText, router_context) {
  const skillBlock = buildPlanPrompt(settings)

  // ลำดับการอ่านที่ออกแบบไว้:
  // 1. รู้ก่อนว่าตัวเองอยู่จุดไหนใน flow (บทบาท)
  // 2. เห็นข้อมูลที่มีอยู่แล้ว (สำคัญสุดสำหรับการตัดสินใจ — วางใกล้ top)
  // 3. รู้ context ของบ้าน
  // 4. รู้ว่าเลือก tool อะไรได้ (เห็นครบ — ไม่ filter)
  // 5. รู้กฎตัดสินใจ + ตัวอย่าง

  const roleBlock = `[หน้าที่ของคุณ — router ตัวต่อมา รับงานต่อจาก router ก่อนหน้า]
router ตัวก่อนหน้าได้ทำการดึงข้อมูลมาให้แล้ว และส่งต่อมาให้คุณตัดสินใจขั้นถัดไป
ผลของรอบก่อนอยู่ใน [ข้อมูลที่ได้มาแล้ว] ข้างล่าง
หน้าที่ตอนนี้: อ่านข้อมูลที่ได้รับ + ดู user request เดิม → ตัดสินใจ step ต่อไปที่จะทำ
ตอบกลับเป็น JSON ก้อนเดียว`

  const dataBlock = `[ข้อมูลที่ได้มาแล้ว — ผลของรอบก่อน]
${router_context}`

  const kgBlock = `[สถานะบ้านตอนนี้]
${kgText}`

  const toolsBlock = `[เครื่องมือที่ใช้ได้]
${skillBlock}`

  const decisionBlock = `[วิธีตัดสินใจ]
ขั้น 1: อ่าน [ข้อมูลที่ได้มาแล้ว] + ดู user request เดิม
ขั้น 2: ถามตัวเอง "ข้อมูลที่มีตอบเงื่อนไขของ user ได้ครบหรือยัง?"
  - ครบแล้ว → ทำ action ตามเงื่อนไข หรือ ไม่ทำอะไรเลย แล้วตั้ง "needs_next_round": false (จบ)
  - ยังไม่ครบ → ค้น/ดึงข้อมูลเพิ่ม (อย่าค้นซ้ำเรื่องที่มีคำตอบอยู่แล้ว) "needs_next_round": true

รูปแบบคำตอบที่เจอบ่อย:

(ก) ข้อมูลครบ + เงื่อนไขเข้า → ใส่ action step
    ตัวอย่าง: ข้อมูล "BTC = $105k", user สั่ง "ถ้า BTC > 100k เปิดไฟห้องนอน"
    ตอบ: {"steps":[{"type":"home_control","device":"ไฟห้องนอน","payload":"ON",...}],"needs_next_round":false}

(ข) ข้อมูลครบ + เงื่อนไขไม่เข้า → ไม่ทำอะไร
    ตัวอย่าง: ข้อมูล "BTC = $80k", user สั่ง "ถ้า BTC > 100k เปิดไฟห้องนอน"
    ตอบ: {"steps":[],"needs_next_round":false}

(ค) user สั่ง 2 ฝั่ง (ถ้า A ทำ X, ถ้า B ทำ Y) → เลือกฝั่งที่ตรงข้อมูล
    ตัวอย่าง: ข้อมูล "หุ้นลง 4%", user สั่ง "ถ้าขึ้นเปิดไฟ ถ้าลงปิดไฟ"
    ตอบ: {"steps":[{"type":"home_control","device":"ไฟหน้าบ้าน","payload":"OFF",...}],"needs_next_round":false}

(ง) ข้อมูลยังไม่ครบ ต้องค้นเพิ่ม → ค้น (ห้ามค้นซ้ำเรื่องเดิม)
    ตัวอย่าง: รอบก่อนได้ราคา BTC วันนี้ แต่ user ถามแนวโน้มสัปดาห์ → ค้นเพิ่ม
    ตอบ: {"steps":[{"type":"realtime_data","query":"แนวโน้มราคา BTC สัปดาห์นี้"}],"needs_next_round":true}`

  return [roleBlock, dataBlock, kgBlock, toolsBlock, decisionBlock].join('\n\n')
}

function buildSystemPrompt(settings, devices, lastCommand, kgText, carryOver) {
  const { router_context, pending_clarify, wait_retry } = carryOver || {}
  if (router_context) {
    return buildRoundTwoPrompt(settings, kgText, router_context)
  }
  return buildRoundOnePrompt(settings, lastCommand, kgText, pending_clarify, wait_retry)
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
  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 600,
    structured: ROUTER_SCHEMA,
  })

  const lastMsg = messages[messages.length - 1]
  const previousMsgs = messages.slice(0, -1)
  const msgs = [new SystemMessage(systemPrompt), ...previousMsgs, new HumanMessage(String(lastMsg?.content || ''))]

  let plan
  try {
    plan = await llm.invoke(msgs, { signal })
  } catch (err) {
    console.warn('  [Router] structured-output failed:', err?.message)
    return {
      plan: null,
      needs_clarify: true,
      clarify_question: 'ขอโทษค่ะ ระบบวิเคราะห์คำสั่งสับสนนิดหน่อย ช่วยพูดใหม่อีกทีได้มั้ยคะ?',
      router_round: (state.router_round || 0) + 1,
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
