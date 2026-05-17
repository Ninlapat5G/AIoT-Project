// synthesizer — สรุปผลของ executor รอบล่าสุด ส่งต่อให้ router ตัวถัดไป
// สรุปแบบ targeted คือเอา user request มาดูด้วย แล้วบอกตรง ๆ ว่าเงื่อนไขเข้าหรือยัง
// router รอบถัดไปอ่านแล้วตัดสินใจ action ได้เลย ไม่ต้องค้นซ้ำ
// ไม่ stream ออก user (เป็น internal handoff)

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { makeLLM } from '../helpers/llmFactory.js'

const SUMMARIZE_PROMPT = `คุณคือคนสรุปข้อมูลส่งให้คนถัดไปทำงานต่อ
- อ่าน [user สั่งอะไรไว้] กับ [ผลที่ค้นมา] แล้วสรุปสั้น ๆ
- บอกข้อเท็จจริงตามที่ค้นมาตรง ๆ ห้ามแต่ง
- ถ้า user มีเงื่อนไข (เช่น "ถ้าหุ้นขึ้น...") ระบุชัดในสรุปว่าเงื่อนไขเข้าหรือไม่
  ตัวอย่าง: "หุ้นขึ้น 5.77% จากสัปดาห์ก่อน → เข้าเงื่อนไขที่ user สั่ง"
- ถ้าข้อมูลที่ค้นมายังไม่ครอบเงื่อนไข ก็บอกตรง ๆ ว่าขาดอะไร
- text ธรรมดา 1-3 ประโยค ห้าม JSON / code`

export async function synthesizerNode(state) {
  const { settings, signal, completed, messages } = state
  if (!completed?.length) return { router_context: '' }

  // หา user message ล่าสุด — เอาเงื่อนไขเดิมมาให้ summarizer
  const userText = (() => {
    const list = messages || []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      const type = m?._getType?.() || m?.constructor?.name
      if (type === 'human' || type === 'HumanMessage') return String(m.content || '')
    }
    return ''
  })()

  const llm = makeLLM(settings, { temperature: 0, maxTokens: 250 })
  const input = `[user สั่งอะไรไว้]
${userText}

[ผลที่ค้นมา]
${completed.map(c => `- ${c}`).join('\n')}`

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

  console.log(`  [Synthesizer] → ${summary.slice(0, 120)}${summary.length > 120 ? '...' : ''}`)
  return { router_context: summary }
}
