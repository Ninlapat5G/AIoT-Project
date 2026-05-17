// synthesizer — สรุปผลของ executor รอบล่าสุดเป็น text สั้นๆ
// เซ็ตใน state.router_context → ส่งกลับเข้า router_planner รอบใหม่
// ไม่ stream ออก user (เป็น internal handoff ระหว่าง router หลายรอบ)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือ summarizer — สรุปผลของ tool calls รอบนี้ให้สั้นและเป็นข้อเท็จจริง
- ไม่แต่งเรื่อง ใช้เฉพาะข้อมูลใน [ผลรอบนี้]
- เน้นค่าตัวเลข / สถานะ / เหตุผลที่ทำให้ตัดสินใจต่อได้ในรอบถัดไป
- ตอบเป็น text ธรรมดา 1-3 ประโยค ห้าม JSON / code`

export async function synthesizerNode(state) {
  const { settings, signal, completed } = state
  if (!completed?.length) return { router_context: '' }

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 200 })
  const input = `[ผลรอบนี้]\n${completed.map(c => `- ${c}`).join('\n')}`

  let summary = ''
  try {
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZE_PROMPT), new HumanMessage(input)],
      { signal }
    )
    summary = String(res.content || '').trim()
  } catch (err) {
    console.warn('  [Synthesizer] failed:', err?.message)
    summary = completed.join(' | ')
  }

  console.log(`  [Synthesizer] → ${summary.slice(0, 100)}${summary.length > 100 ? '...' : ''}`)
  return { router_context: summary }
}
