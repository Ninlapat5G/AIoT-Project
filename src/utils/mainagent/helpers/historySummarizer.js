import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { makeLLM } from './llmFactory.js'

const SUMMARIZER_PROMPT = `สรุปบทสนทนา ตอบด้วย tag เท่านั้น ห้ามมีข้อความอื่น

[CHAT_SUMMARY]
สรุปบทสนทนาทั่วไปเป็น bullet points สั้นๆ (ทักทาย ถามความรู้ ผลค้นเว็บ)
ถ้ามี [PREV_CHAT_SUMMARY] ให้ carry forward มารวมด้วย
*ถ้าไม่มีบทสนทนาแบบนี้เลย ให้เว้นว่างไว้*

[LAST_COMMAND]
คำสั่งอุปกรณ์ล่าสุด 1 รายการ เช่น: เปิดไฟห้องนั่งเล่น
*ถ้าไม่มีคำสั่งอุปกรณ์เลย ให้เว้นว่างไว้*

[PENDING_ANSWER]
สิ่งที่รอคำตอบจาก user 1 บรรทัด เช่น: รอ user ตอบว่าจะตั้งแอร์กี่องศา
ถ้ามี [PREV_PENDING_ANSWER] และ user ยังไม่ได้ตอบในรอบนี้ ให้ carry forward
*ถ้าไม่มีอะไรค้าง ให้เว้นว่างไว้*`

function parseTags(text) {
  const extract = (tag) => {
    const match = text.match(new RegExp(`\\[${tag}\\][^\\S\\r\\n]*\\r?\\n([\\s\\S]*?)(?=\\[|$)`))
    return match ? match[1].trim() : ''
  }
  return {
    chat_summary:   extract('CHAT_SUMMARY'),
    last_command:   extract('LAST_COMMAND') || null,
    pending_answer: extract('PENDING_ANSWER'),
  }
}

export async function summarizeHistory(messages, settings, signal, kgSnapshot = '', pendingContext = '', prevChatSummary = '', prevPendingAnswer = '') {
  if (messages.length === 0) return { chat_summary: prevChatSummary, last_command: null, pending_answer: prevPendingAnswer }

  const historyText = messages.map(msg => {
    if (msg instanceof HumanMessage) return `User: ${msg.content}`
    if (msg instanceof AIMessage)    return `Assistant: ${msg.content}`
    return ''
  }).filter(Boolean).join('\n')

  const parts = []
  if (prevChatSummary)   parts.push(`[PREV_CHAT_SUMMARY]\n${prevChatSummary}`)
  if (prevPendingAnswer) parts.push(`[PREV_PENDING_ANSWER]\n${prevPendingAnswer}`)
  if (kgSnapshot)        parts.push(`[สถานะอุปกรณ์ปัจจุบัน]\n${kgSnapshot}`)
  parts.push(`[บทสนทนารอบนี้]\n${historyText}`)
  if (pendingContext)    parts.push(`[หมายเหตุระบบ — ใช้ช่วย PENDING_ANSWER]\n${pendingContext}`)
  const inputText = parts.join('\n\n')

  try {
    const llm = makeLLM(settings, { temperature: 0, maxTokens: 600 })
    const res = await llm.invoke(
      [new SystemMessage(SUMMARIZER_PROMPT), new HumanMessage(inputText)],
      { signal }
    )
    return parseTags(String(res.content || ''))
  } catch (err) {
    console.warn('[Summarizer] failed:', err?.message)
    return { chat_summary: prevChatSummary, last_command: null, pending_answer: prevPendingAnswer }
  }
}
