import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { snapshotText } from '../../kg.js'
import { makeLLM, nowString } from '../helpers/llmFactory.js'
import { parseJSON } from '../helpers/jsonParser.js'
import { buildPlanPrompt, buildPlanExamples } from '../skills/index.js'

function buildSystemPrompt(settings, devices, lastCommand, kgText, carryOver) {
  const skillBlock = buildPlanPrompt(settings)
  const examples = buildPlanExamples(settings)

  const lastCommandBlock = lastCommand
    ? `\n[คำสั่งอุปกรณ์ล่าสุดในประวัติ (อ้างอิงสำหรับ clarify)]\n${lastCommand}\n`
    : ''

  const { router_context, pending_clarify, wait_retry } = carryOver || {}

  const routerContextBlock = router_context
    ? `\n[ผลของรอบก่อน (ใน turn เดียวกัน)]\n${router_context}\n— ใช้ข้อมูลนี้ตัดสินใจว่าจะทำต่อหรือไม่ และทำอะไร\n`
    : ''

  const pendingClarifyBlock = pending_clarify
    ? `\n[คำถามที่ถามไว้ใน turn ก่อน — รอ user ตอบ]\n${pending_clarify}\n— ถ้า message ใหม่ของ user ดูเหมือนตอบคำถามข้างบน ให้ plan task เดิมตามคำตอบนั้น; ถ้า user เปลี่ยนเรื่อง ให้ทิ้งคำถามนี้แล้ว plan ตามเรื่องใหม่\n`
    : ''

  const waitRetryBlock = wait_retry
    ? `\n[งานที่ทำไม่สำเร็จใน turn ก่อน — รอ user สั่งต่อ]\n${wait_retry}\n— ถ้า user สั่ง "ลองอีกที" / "ทำต่อ" หรือยืนยันให้ทำ ให้ plan งานเหล่านี้; ถ้า user เปลี่ยนเรื่อง ให้ทิ้งและ plan ตามเรื่องใหม่\n`
    : ''

  return `${kgText}${lastCommandBlock}${routerContextBlock}${pendingClarifyBlock}${waitRetryBlock}
ดูคำสั่งล่าสุดของ user แล้วสร้าง plan จาก history + KG

[การอ้างอิงคำสั่งก่อนหน้า]
ถ้า user พูดสั้นๆ เช่น "ปิดเลย" "อันนั้น" "มัน" "ด้วย" "อีกอัน" — ให้ดู history ว่ากำลังพูดถึงอุปกรณ์ใด แล้วสร้าง plan ตามนั้นได้เลย ห้ามถามซ้ำถ้า context ชัดเจนอยู่แล้ว

[การวางแผนแบบ 2 รอบ — needs_next_round]
วิเคราะห์ว่า task ของ user ทำในรอบเดียวพอ หรือ ต้องเก็บข้อมูล realtime ก่อนค่อยตัดสินใจขั้นต่อไป
- รอบเดียวพอ → ใส่ทุก step ที่ต้องทำ + "needs_next_round": false
- ต้องเก็บข้อมูลก่อน (เช่น "ดูราคา X ถ้าเกิน Y ให้ทำ Z") → รอบนี้ใส่แค่ step ที่ดึงข้อมูล + "needs_next_round": true (ระบบจะส่งสรุปผลให้คุณตัดสินใจต่อรอบถัดไป)
- ถ้า [ผลของรอบก่อน] มีอยู่แล้ว — แปลว่าคุณกำลังอยู่รอบที่ 2 ให้ตัดสินใจตามข้อมูลที่ได้ และตั้ง "needs_next_round": false (จบ)

[ประเภท step ที่ใส่ใน plan ได้]
${skillBlock}

[คำเตือนเด็ดขาด!] ตอบกลับมาเป็น JSON ตามตัวอย่างเท่านั้น ห้ามมีคำเกริ่นนำ คำอธิบาย หรือคำว่า 'รับทราบ' นอก JSON (ค่า value ภายใน JSON เป็นภาษาไทยได้ตามปกติ)

ถ้าวางแผนได้:
{"steps": [
  ${examples}
], "needs_next_round": false}

ถ้าต้องเก็บข้อมูลก่อนแล้วค่อยตัดสินใจอีกรอบ:
{"steps": [ ...steps สำหรับเก็บข้อมูล... ], "needs_next_round": true}

ถ้าตัดสินใจแล้วว่าไม่ต้องทำอะไรเพิ่ม (เช่น เงื่อนไขไม่เข้า):
{"steps": [], "needs_next_round": false}

ถ้ามีอะไรยังไม่ชัด ให้ถามผ่าน general ก่อน (อย่ารันอะไรอื่นเลย):
{"steps": [{"type": "general", "response": "คำถาม clarify"}], "needs_next_round": false}

ถ้าต้องถามล้วน (ใช้ได้เหมือนกัน):
{"need_clarify": true, "question": "..."}`
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
  const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })

  // แนบ reminder ปิดท้ายข้อความ user ล่าสุด เพื่อบังคับให้ LLM ตอบเป็น JSON ไม่หลุดไปคุยเล่น
  const lastMsg = messages[messages.length - 1]
  const previousMsgs = messages.slice(0, -1)

  const strictLastMsg = new HumanMessage(
    `${lastMsg?.content || ''}\n\n[คำเตือนจากระบบ: วิเคราะห์คำสั่งด้านบนแล้วตอบกลับเป็นโครงสร้าง JSON เท่านั้น ห้ามตอบเป็นข้อความแชทธรรมดาเด็ดขาด!]`
  )

  const msgs = [new SystemMessage(systemPrompt), ...previousMsgs, strictLastMsg]

  let plan
  try {
    const res = await llm.invoke(msgs, { signal })
    plan = parseJSON(String(res.content || ''))
  } catch {
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
        router_round: (state.router_round || 0) + 1,
      }
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
  if (nextRound >= maxRounds) needsNextRound = false  // รอบสุดท้าย — บังคับจบ ไม่ chain

  console.log(`  [Router #${nextRound}] plan → ${JSON.stringify(steps.map(s => s.type))} | needs_next_round=${needsNextRound}`)

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
