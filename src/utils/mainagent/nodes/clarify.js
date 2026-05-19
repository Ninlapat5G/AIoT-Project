// clarify_node — โผล่คำถามให้ user แล้วจบ (ไม่ stream, ส่งเป็น message ตรง)
//
// LLM ไม่ทำงานในโหนดนี้ — แค่ส่งคำถามจาก state.clarify_question

import { AIMessage } from '@langchain/core/messages'

export async function clarifyNode(state) {
  const t0 = Date.now()
  console.log('  [Clarify] start')
  const { clarify_question, onStream } = state
  const question = clarify_question || 'ช่วยบอกรายละเอียดเพิ่มเติมได้มั้ยคะ?'

  console.log(`  [Clarify] → ${question} (${Date.now() - t0}ms)`)

  // stream ทีเดียว ให้ UI เห็นเป็นข้อความเดียวกัน
  onStream?.(question)

  return { messages: [new AIMessage(question)] }
}
