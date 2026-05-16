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

function buildSystemPrompt(settings, devices, lastCommand) {
  const kg = snapshotText({ devices, settings, now: nowString() })
  const skillBlock = buildPlanPrompt(settings)
  const examples = buildPlanExamples(settings)

  const lastCommandBlock = lastCommand
    ? `\n[คำสั่งอุปกรณ์ล่าสุดในประวัติ (อ้างอิงสำหรับ clarify)]\n${lastCommand}\n`
    : ''

  return `${kg}${lastCommandBlock}
ดูคำสั่งล่าสุดของ user แล้วสร้าง plan จาก history + KG

[การอ้างอิงคำสั่งก่อนหน้า]
ถ้า user พูดสั้นๆ เช่น "ปิดเลย" "อันนั้น" "มัน" "ด้วย" "อีกอัน" — ให้ดู history ว่ากำลังพูดถึงอุปกรณ์ใด แล้วสร้าง plan ตามนั้นได้เลย ห้ามถามซ้ำถ้า context ชัดเจนอยู่แล้ว

[ประเภท step ที่ใส่ใน plan ได้]
${skillBlock}

[คำเตือนเด็ดขาด!] ตอบกลับมาเป็น JSON ตามตัวอย่างเท่านั้น ห้ามมีคำเกริ่นนำ คำอธิบาย หรือคำว่า 'รับทราบ' นอก JSON (ค่า value ภายใน JSON เป็นภาษาไทยได้ตามปกติ)

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

  const kgText = snapshotText({ devices, settings, now: nowString() })
  const systemPrompt = buildSystemPrompt(settings, devices, state.lastCommand)
  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  let msgsToUse = messages
  let nextLastCommand = state.lastCommand ?? null

  if (messages.length > 10) {
    const result = await summarizeHistory(messages, settings, signal, kgText)
    msgsToUse = result.messages
    if (result.lastCommand) nextLastCommand = result.lastCommand
  }

  const msgs = [new SystemMessage(systemPrompt), ...msgsToUse]

  let plan
  try {
    const res = await llm.invoke(msgs, { signal })
    plan = parseJSON(String(res.content || ''))
  } catch {
    // retry ครั้งเดียวพร้อม reminder ให้ตอบ JSON
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
      }
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

  return { plan: { steps }, needs_clarify: false, completed: [], lastCommand: nextLastCommand }
}
