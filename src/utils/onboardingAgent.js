/**
 * Onboarding Agent — "ซิน"
 *
 * Agent 1 (ซิน): รับข้อความจาก user, ตอบโต้ด้วยบุคลิกขี้เล่นเป็นกันเอง
 * Agent 2 (Inspector): tool ที่ซินเรียกเพื่ออ่านสถานะระบบ (read-only)
 *
 * แยกไฟล์นี้ออกมาให้ clean — เอาออกได้ง่ายโดยไม่กระทบ main agent
 */

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { DEFAULT_API_KEY } from '../config/default_key'

// ── ซิน Persona ───────────────────────────────────────────────────────────────

const SIN_SYSTEM_PROMPT = `คุณคือ "ซิน" — AI ผู้ช่วยของระบบ SynaptaOS
เพศ: หญิง | บุคลิก: ขี้เล่น เป็นกันเอง ร่าเริง ใช้อีโมจิพอประมาณ
ตอบภาษาไทยเสมอ ใช้ภาษาลำลองเป็นธรรมชาติ
เรียก user ว่า "คุณ" ก่อนรู้จักชื่อ หลังรู้จักแล้วใช้ชื่อ

สิ่งที่ซินทำได้:
- ต้อนรับ user ใหม่ แนะนำตัวเองและระบบ
- ถามชื่อ user เพื่อใช้ในการสื่อสาร
- อธิบาย step การตั้งค่า (Typhoon API key, Serper API key)
- เรียก inspect_system เพื่อดูสถานะระบบก่อนให้คำแนะนำ

สิ่งที่ซินทำไม่ได้: ควบคุมอุปกรณ์, ค้นหาเว็บ, รันคำสั่ง OS
ถ้าถูกถามเรื่องพวกนั้น บอกให้ไปใช้ AI หลักในหน้า Chat ปกติแทน

ลิงค์สำคัญ (แปะให้ user เลยเมื่อแนะนำ):
- Typhoon API key: https://playground.opentyphoon.ai/settings/api-key
- Serper API key: https://serper.dev/api-keys`

// ── Inspector Tool (Agent 2) ──────────────────────────────────────────────────

const INSPECT_TOOL = {
  type: 'function',
  function: {
    name: 'inspect_system',
    description: 'ตรวจสอบสถานะการตั้งค่าระบบปัจจุบัน ใช้ก่อนให้คำแนะนำ user เสมอ',
    parameters: { type: 'object', properties: {} },
  },
}

function buildSystemStatus(settings, devicesRef) {
  const usingDefault = !settings.apiKey || settings.apiKey === DEFAULT_API_KEY
  return {
    typhoonApiKey: usingDefault
      ? 'ยังใช้ key เริ่มต้นของระบบ (แนะนำให้เปลี่ยนเป็น key ส่วนตัว)'
      : 'ตั้งค่า key ส่วนตัวแล้ว ✓',
    serperApiKey: settings.serperApiKey
      ? 'ตั้งค่าแล้ว ✓ (ใช้ web search ได้)'
      : 'ยังไม่ได้ตั้งค่า — ถ้าใส่จะทำให้ AI ค้นหาเว็บได้',
    userName: settings.profile?.userBio || 'ยังไม่ได้ระบุ',
    model: settings.model,
    devicesConfigured: devicesRef?.current?.length ?? 0,
  }
}

// ── LLM Builder ───────────────────────────────────────────────────────────────

function makeLLM(settings, withTools = false) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.75,
  })
  return withTools ? llm.bindTools([INSPECT_TOOL]) : llm
}

// ── Name Extractor ────────────────────────────────────────────────────────────
// Returns { name, initials } — both '' if no name found
export async function extractNameFromText(text, settings) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  const empty = { name: '', initials: '' }
  try {
    const llm = new ChatOpenAI({
      apiKey,
      configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
      modelName: settings.model,
      temperature: 0,
      maxTokens: 20,
    })
    const res = await llm.invoke([
      new SystemMessage('ดึงชื่อที่ผู้ใช้ต้องการให้เรียก และตัวย่อสำหรับแสดงในกล่อง ตอบในรูปแบบ ชื่อ|ตัวย่อ เช่น บิน|บ หรือ Sarah Chen|SC ถ้าไม่มีชื่อชัดเจนตอบว่า NONE'),
      new HumanMessage(text),
    ])
    const raw = typeof res.content === 'string' ? res.content.trim() : ''
    if (!raw || raw === 'NONE') return empty
    const [namePart, initPart] = raw.split('|')
    const name = namePart?.trim() || ''
    const initials = (initPart?.trim() || name[0]?.toUpperCase() || '').slice(0, 2)
    return name ? { name, initials } : empty
  } catch {
    return empty
  }
}

// ── API Key Tester ────────────────────────────────────────────────────────────

export async function testApiKey(apiKey, endpoint, model) {
  try {
    const llm = new ChatOpenAI({
      apiKey,
      configuration: { apiKey, baseURL: endpoint, dangerouslyAllowBrowser: true },
      modelName: model,
      maxTokens: 3,
      temperature: 0,
    })
    await llm.invoke([new HumanMessage('hi')])
    return true
  } catch {
    return false
  }
}

// ── Main ซิน Runner ──────────────────────────────────────────────────────────
// Agent 1 รับ message → อาจเรียก inspect_system (Agent 2) → ตอบ user

export async function runSin({ stageContext, userMessage, apiHistory, settings, devicesRef, signal, onStream }) {
  const llmWithTools = makeLLM(settings, true)
  const llmPlain = makeLLM(settings, false)

  const systemMsg = new SystemMessage(SIN_SYSTEM_PROMPT)
  const ctxMsg = new SystemMessage(stageContext)

  const histMsgs = (apiHistory || []).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  )

  const trigger = userMessage
    ? new HumanMessage(userMessage)
    : new HumanMessage('[SYSTEM_TRIGGER] เริ่มต้นการสนทนา ทักทาย user ใหม่และถามชื่อ')

  const allMsgs = [systemMsg, ctxMsg, ...histMsgs, trigger]

  // Pass 1 — ซิน อาจเรียก inspect_system
  const stream1 = await llmWithTools.stream(allMsgs, { signal })
  let resp1
  for await (const chunk of stream1) {
    if (!resp1) resp1 = chunk
    else resp1 = resp1.concat(chunk)
    if (chunk.content && !chunk.tool_call_chunks?.length) {
      onStream?.(chunk.content)
    }
  }

  if (!resp1?.tool_calls?.length) return resp1?.content || ''

  // Pass 2 — Inspector ตอบกลับ → ซิน สรุปให้ user
  const toolMsgs = resp1.tool_calls.map(tc =>
    new ToolMessage({
      content: JSON.stringify(buildSystemStatus(settings, devicesRef)),
      name: tc.name,
      tool_call_id: tc.id,
    })
  )

  const stream2 = await llmPlain.stream([...allMsgs, resp1, ...toolMsgs], { signal })
  let resp2
  for await (const chunk of stream2) {
    if (!resp2) resp2 = chunk
    else resp2 = resp2.concat(chunk)
    if (chunk.content) onStream?.(chunk.content)
  }

  return resp2?.content || ''
}
