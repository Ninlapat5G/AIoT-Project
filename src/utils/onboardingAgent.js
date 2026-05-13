/**
 * Onboarding Agent — "ซิน"
 *
 * LangGraph 2 nodes:
 *   sin        — ซินตอบ user (มี inspect_system tool)
 *   name_saver — จับชื่อหรือตรวจการปฏิเสธ → เปลี่ยน stage เป็น setup
 *
 * Stage:
 *   intro   → แนะนำตัว ถามชื่อ
 *   setup   → แนะนำตั้งค่า Typhoon + Serper
 *   farewell → กล่าวลา ส่งต่อ AI หลัก
 */

import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { DEFAULT_API_KEY } from '../config/default_key'

// ── System Prompt ──────────────────────────────────────────────────────────────

const SIN_SYSTEM = `คุณคือ "ซิน" — AI ผู้ช่วยต้อนรับของ SynaptaOS
เพศ: หญิง | บุคลิก: ขี้เล่น เป็นกันเอง ร่าเริง ใช้อีโมจิพอประมาณ
ตอบภาษาไทยเสมอ ใช้ภาษาลำลองเป็นธรรมชาติ

สิ่งที่ซินทำได้:
- ต้อนรับ user ใหม่ แนะนำตัวเองและระบบ
- ถามชื่อ user เพื่อใช้ในการสื่อสาร
- แนะนำการตั้งค่า API key พร้อมอธิบายเหตุผล
- เรียก inspect_system เพื่อดูสถานะระบบก่อนให้คำแนะนำ

สิ่งที่ซินทำไม่ได้: ควบคุมอุปกรณ์, ค้นหาเว็บ, รันคำสั่ง OS
- ถ้า user ถามเรื่องควบคุมอุปกรณ์ → บอกว่า "ต้องตั้งค่า Typhoon API key ก่อนค่ะ หลังจากนั้น AI ซินถึงจะเข้าถึงอุปกรณ์ได้"
- ถ้า user ถามเรื่องอื่นที่ทำไม่ได้ → บอกตรงๆ อย่าแกล้งทำ

ลิงค์สำคัญ (ใส่ให้ user เลยเมื่อแนะนำ):
- Typhoon API key: https://playground.opentyphoon.ai/settings/api-key
- Serper API key: https://serper.dev/api-keys`

// ── Stage Contexts ─────────────────────────────────────────────────────────────

const STAGE_CONTEXT = {
  intro: `[ขั้นตอน: แนะนำตัว]
แนะนำตัวเองสั้นๆ อบอุ่น แล้วถามว่า "อยากให้เรียกว่าอะไรดีคะ?"
ถ้า user ถามเรื่องอื่นก่อน ตอบได้ แต่ขอชื่อต่อเป็นธรรมชาติหลังตอบเสร็จ
ถ้า user ถาม "ทำไมต้องบอกชื่อ" → บอกว่าแค่ทำให้คุยกันเป็นธรรมชาติ ไม่บังคับ
ถ้า user ปฏิเสธบอกชื่อ → โอเคค่ะ บอกว่าจะเรียกว่า "คุณ" แล้วเดินหน้าต่อ
ยังไม่ต้องอธิบายเรื่อง API key จนกว่าจะรู้จักกันก่อน`,

  setup: `[ขั้นตอน: แนะนำตั้งค่า]
เรียก inspect_system ก่อนเสมอเพื่อดูสถานะปัจจุบัน แล้วแนะนำตามสถานะจริง

อธิบายเหตุผลก่อนบอกให้ทำ:
- Typhoon API key = สมองของ AI ถ้าไม่ใส่จะใช้ key สาธารณะที่อาจช้าหรือหมด quota — จำเป็น
- Serper API key = ช่วยให้ AI ค้นข้อมูลจากอินเทอร์เน็ตได้ ถ้าไม่ใส่ก็ใช้ได้ปกติ — optional

ถ้า user ถามว่าทำไมต้องใส่ → อธิบายจริงๆ อย่าแค่บอกให้ทำ`,

  farewell: `[ขั้นตอน: กล่าวลา]
user ตั้งค่า Typhoon API key เสร็จแล้ว ระบบตรวจสอบแล้วว่าใช้งานได้
ส่ง farewell message อบอุ่น น่ารัก บอกว่าซินออกไปแล้ว
AI หลักจะเข้ามาดูแลแทน อาจทิ้ง hint เล็กน้อยเกี่ยวกับสิ่งที่ทำได้
จบด้วยคำอำลาสั้นๆ น่ารักๆ`,
}

// ── Tools ──────────────────────────────────────────────────────────────────────

const INSPECT_TOOL = {
  type: 'function',
  function: {
    name: 'inspect_system',
    description: 'ตรวจสอบสถานะการตั้งค่าระบบปัจจุบัน ใช้ก่อนให้คำแนะนำเสมอ',
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
      : 'ยังไม่ได้ตั้งค่า — optional',
    userName: settings.profile?.userBio || 'ยังไม่ได้ระบุ',
    model: settings.model,
    devicesConfigured: devicesRef?.current?.length ?? 0,
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

const OnboardingState = Annotation.Root({
  messages:   Annotation({ reducer: messagesStateReducer, default: () => [] }),
  userName:   Annotation({ reducer: (_, next) => next, default: () => '' }),
  stage:      Annotation({ reducer: (_, next) => next, default: () => 'intro' }),
  settings:   Annotation(),
  devicesRef: Annotation(),
  onStream:   Annotation(),
  signal:     Annotation(),
})

// ── LLM Builder ───────────────────────────────────────────────────────────────

function makeLLM(settings, { tools, structured, maxTokens } = {}) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  let llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.75,
    ...(maxTokens ? { maxTokens } : {}),
  })
  if (tools)      llm = llm.bindTools(tools)
  if (structured) llm = llm.withStructuredOutput(structured)
  return llm
}

// ── Node: sin ─────────────────────────────────────────────────────────────────

async function sinNode(state) {
  const { messages, userName, stage, settings, devicesRef, onStream, signal } = state

  const userCtx = userName && userName !== 'ไม่ระบุ'
    ? `\nชื่อ user: ${userName}`
    : userName === 'ไม่ระบุ' ? '\nuser ไม่ระบุชื่อ ให้เรียกว่า "คุณ"' : ''

  const stageCtx = STAGE_CONTEXT[stage] || STAGE_CONTEXT.setup

  const fullMessages = [
    new SystemMessage(SIN_SYSTEM + userCtx),
    new SystemMessage(stageCtx),
    ...messages,
  ]

  // Pass 1 — ซิน อาจเรียก inspect_system
  // ไม่ stream ตอน pass 1 เพราะถ้ามี tool call content ที่ stream ไปแล้วจะหาย
  const llmWithTool = makeLLM(settings, { tools: [INSPECT_TOOL] })
  const stream1 = await llmWithTool.stream(fullMessages, { signal })
  let resp1
  for await (const chunk of stream1) {
    if (!resp1) resp1 = chunk
    else resp1 = resp1.concat(chunk)
  }

  // ไม่มี tool call → stream content ให้ user แล้วจบ
  if (!resp1?.tool_calls?.length) {
    if (resp1?.content) onStream?.(resp1.content)
    return { messages: [resp1] }
  }

  // Pass 2 — inspect_system ถูกเรียก → ตอบพร้อมสถานะจริง
  const toolMsgs = resp1.tool_calls.map(tc => new ToolMessage({
    content: JSON.stringify(buildSystemStatus(settings, devicesRef)),
    name: tc.name,
    tool_call_id: tc.id,
  }))

  const llmPlain = makeLLM(settings)
  const stream2 = await llmPlain.stream(
    [...fullMessages, resp1, ...toolMsgs],
    { signal }
  )
  let resp2
  for await (const chunk of stream2) {
    if (!resp2) resp2 = chunk
    else resp2 = resp2.concat(chunk)
    if (chunk.content) onStream?.(chunk.content)
  }

  return { messages: [resp1, ...toolMsgs, resp2] }
}

// ── Node: name_saver ──────────────────────────────────────────────────────────

const NAME_SAVER_PROMPT = `วิเคราะห์ข้อความจาก user แล้วตอบ JSON:
- name: ชื่อที่ user ต้องการให้เรียก (string ว่างถ้าไม่มี)
- refused: true ถ้า user ปฏิเสธชัดเจนว่าไม่บอกชื่อ`

async function nameSaverNode(state) {
  const { messages, userName, settings, signal } = state

  // รู้จักชื่อแล้ว หรือ farewell → ข้ามไป
  if (userName) return {}

  const lastHuman = [...messages].reverse().find(m => m instanceof HumanMessage)
  if (!lastHuman) return {}

  const llm = makeLLM(settings, {
    maxTokens: 30,
    structured: {
      type: 'object',
      properties: {
        name:    { type: 'string' },
        refused: { type: 'boolean' },
      },
      required: ['name', 'refused'],
    },
  })

  try {
    const res = await llm.invoke(
      [new SystemMessage(NAME_SAVER_PROMPT), new HumanMessage(lastHuman.content)],
      { signal }
    )
    if (res.name?.trim())  return { userName: res.name.trim(), stage: 'setup' }
    if (res.refused)       return { userName: 'ไม่ระบุ',      stage: 'setup' }
  } catch { /* ถ้า fail รอรอบถัดไป */ }

  return {}
}

// ── Graph ──────────────────────────────────────────────────────────────────────

const compiled = new StateGraph(OnboardingState)
  .addNode('sin', sinNode)
  .addNode('name_saver', nameSaverNode)
  .addEdge(START, 'sin')
  .addEdge('sin', 'name_saver')
  .addEdge('name_saver', END)
  .compile()

// ── Public API ────────────────────────────────────────────────────────────────

export async function runSin({ userMessage, apiHistory, userName, stage, settings, devicesRef, signal, onStream }) {
  const histMsgs = (apiHistory || []).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  )

  const trigger = userMessage
    ? new HumanMessage(userMessage)
    : new HumanMessage('[SYSTEM_TRIGGER] เริ่มต้นการสนทนา ทักทาย user ใหม่และแนะนำตัวเอง')

  const finalState = await compiled.invoke({
    messages:   [...histMsgs, trigger],
    userName:   userName || '',
    stage:      stage   || 'intro',
    settings,
    devicesRef,
    onStream,
    signal,
  })

  const lastMsg = finalState.messages[finalState.messages.length - 1]
  return {
    reply:    lastMsg?.content || '',
    userName: finalState.userName,
    stage:    finalState.stage,
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

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
