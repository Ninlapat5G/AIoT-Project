// router_planner — LLM ครั้งที่ 1: วาง plan เป็น JSON
//
// Input: KG snapshot + skill prompts + history (summarized) + user message
// Output: state.plan = { steps: [...] } หรือ { need_clarify: true, question }

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'
import { buildPlanPrompt, buildPlanExamples } from '../skills/index.js'

function buildSystemPrompt(settings, devices) {
  const kg = snapshotText({ devices, settings, now: nowString() })
  const skillBlock = buildPlanPrompt(settings)
  const examples = buildPlanExamples(settings)

  return `${kg}

ดูคำสั่งล่าสุดของ user แล้วสร้าง plan จาก history + KG

[ประเภท step ที่ใส่ใน plan ได้]
${skillBlock}

[คำเตือนเด็ดขาด!] ห้ามพิมพ์คำเกริ่นนำ ห้ามอธิบาย และห้ามพิมพ์คำว่า 'รับทราบ' ตอบกลับมาเป็นโครงสร้าง JSON ล้วนๆ ตามตัวอย่างเท่านั้น

ถ้าวางแผนได้:
{"steps": [
  ${examples}
]}

ถ้ามีอะไรยังไม่ชัด ให้ถามผ่าน general ก่อน (อย่ารันอะไรอื่นเลย):
{"steps": [{"type": "general", "response": "คำถาม clarify"}]}

ถ้าต้องถามล้วน (ใช้ได้เหมือนกัน):
{"need_clarify": true, "question": "..."}`
}

export async function routerPlannerNode(state) {
  const { settings, signal } = state
  const devices = (state.deviceList?.current ?? state.deviceList) || []
  const messages = state.messages || []

  const systemPrompt = buildSystemPrompt(settings, devices)
  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  // บีบ history เฉพาะตอน convo ยาวจริงๆ (>10 msgs) — สั้นกว่านั้นใช้ full history
  // เพื่อให้ planner เห็น clarify question + user reply ครบ
  const msgsToUse = messages.length > 10
    ? await summarizeHistory(messages, settings, signal)
    : messages

  let plan
  try {
    const res = await llm.invoke(
      [new SystemMessage(systemPrompt), ...msgsToUse],
      { signal }
    )
    plan = parseJSON(String(res.content || ''))
  } catch (err) {
    console.warn('  [Router] parse error → ask user:', err?.message)
    return {
      plan: null,
      needs_clarify: true,
      clarify_question: 'ขอโทษค่ะ ระบบวิเคราะห์คำสั่งสับสนนิดหน่อย ช่วยพูดใหม่อีกทีได้มั้ยคะ?',
    }
  }

  if (plan?.need_clarify) {
    console.log(`  [Router] need_clarify → ${plan.question}`)
    return {
      plan,
      needs_clarify: true,
      clarify_question: plan.question || 'ช่วยบอกรายละเอียดเพิ่มเติมได้มั้ยคะ?',
    }
  }

  const steps = Array.isArray(plan?.steps) ? plan.steps : []
  console.log(`  [Router] plan → ${JSON.stringify(steps.map(s => s.type))}`)

  return { plan: { steps }, needs_clarify: false, completed: [] }
}
