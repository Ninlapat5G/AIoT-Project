// Onboarding Agent — plan-based version ของ "ซิน"
//
// Flow:
//   user → router_planner (เลือก skill ตาม stage) → plan_executor → response → END
//
// Public API: runSin(params) — signature เดิม ใช้แทน onboardingAgent.js ของเก่าได้

import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

import { routerPlannerNode } from './nodes/routerPlanner.js'
import { planExecutorNode }  from './nodes/planExecutor.js'
import { responseNode }      from './nodes/response.js'
import { DEFAULT_API_KEY } from '../../config/default_key.js'

// ── State ─────────────────────────────────────────────────────────────────────

const OnboardingState = Annotation.Root({
  messages:   Annotation({ reducer: messagesStateReducer, default: () => [] }),
  userName:   Annotation({ reducer: (_, n) => n, default: () => '' }),
  stage:      Annotation({ reducer: (_, n) => n, default: () => 'intro' }),
  settings:   Annotation(),
  devicesRef: Annotation(),
  signal:     Annotation(),

  onPlanReady:  Annotation(),
  onStepStart:  Annotation(),
  onStepResult: Annotation(),
  onStream:     Annotation(),

  plan:      Annotation({ reducer: (_, n) => n, default: () => null }),
  completed: Annotation({ reducer: (_, n) => n, default: () => [] }),
})

// แตะ onPlanReady ก่อน execute
async function announcePlan(state) {
  const { plan, onPlanReady } = state
  if (plan?.steps?.length) onPlanReady?.(plan)
  return {}
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const workflow = new StateGraph(OnboardingState)
  .addNode('router_planner', routerPlannerNode)
  .addNode('announce',       announcePlan)
  .addNode('plan_executor',  planExecutorNode)
  .addNode('response',       responseNode)
  .addEdge(START, 'router_planner')
  .addEdge('router_planner', 'announce')
  .addEdge('announce',       'plan_executor')
  .addEdge('plan_executor',  'response')
  .addEdge('response',       END)

const compiled = workflow.compile()

// ── Public API ────────────────────────────────────────────────────────────────

export async function runSin(params) {
  const {
    userMessage, apiHistory,
    userName, stage, settings, devicesRef, signal,
    onStream, onPlanReady, onStepStart, onStepResult,
  } = params

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
    signal,
    onStream, onPlanReady, onStepStart, onStepResult,
  })

  const lastMsg = finalState.messages?.[finalState.messages.length - 1]
  return {
    reply:    lastMsg?.content || '',
    userName: finalState.userName,
    stage:    finalState.stage,
  }
}

// ── Utilities (สำหรับ useOnboarding) ──────────────────────────────────────────

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
    const name     = namePart?.trim() || ''
    const initials = (initPart?.trim() || name[0]?.toUpperCase() || '').slice(0, 2)
    return name ? { name, initials } : empty
  } catch {
    return empty
  }
}
