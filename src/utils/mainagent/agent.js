import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, trimMessages } from '@langchain/core/messages'

import { routerPlannerNode } from './nodes/routerPlanner.js'
import { planExecutorNode }  from './nodes/planExecutor.js'
import { chatNode }          from './nodes/chat.js'
import { responseNode }      from './nodes/response.js'
import { evaluatorNode }     from './nodes/evaluator.js'
import { memoryCompressorNode } from './nodes/memoryCompressor.js'

// ── State ─────────────────────────────────────────────────────────────────────

const appendArray = (curr, next) => [...(curr || []), ...(next || [])]

const AgentState = Annotation.Root({
  messages:        Annotation({ reducer: messagesStateReducer, default: () => [] }),
  settings:        Annotation(),
  deviceList:      Annotation(),
  signal:          Annotation(),

  mqttClient:         Annotation(),
  mqttRequestResponse: Annotation(),
  devicesRef:      Annotation(),
  baseTopicRef:    Annotation(),
  setDevices:      Annotation(),
  handleSaveSettings: Annotation(),

  onPlanReady:      Annotation(),
  onStepStart:      Annotation(),
  onStepResult:     Annotation(),
  onStream:         Annotation(),
  onInterimStatus:  Annotation(),

  plan:             Annotation({ reducer: (_, n) => n, default: () => null }),
  // completed: append ข้ามรอบของ multi-router ภายใน turn เดียว (reset ใน runAgent ทุก turn)
  completed:        Annotation({ reducer: appendArray, default: () => [] }),
  lastCommand:      Annotation({ reducer: (_, n) => n, default: () => null }),

  // multi-router state
  router_round:     Annotation({ reducer: (_, n) => n, default: () => 0 }),
  needs_next_round: Annotation({ reducer: (_, n) => n, default: () => false }),

  // executor failure tracking
  has_failed_step: Annotation({ reducer: (_, n) => n, default: () => false }),
  failed_steps:    Annotation({ reducer: appendArray, default: () => [] }),

  // carry-over ข้าม turn — 3 bucket ที่ memoryCompressor ผลิต + routerPlanner บริโภค
  // lastCommand อยู่ข้างบนแล้ว (ใช้ร่วมกัน)
  chat_summary:    Annotation({ reducer: (_, n) => n, default: () => '' }),
  pending_answer:  Annotation({ reducer: (_, n) => n, default: () => '' }),
})

// ── Routing ───────────────────────────────────────────────────────────────────

function routeAfterRouter(state) {
  const steps = state.plan?.steps || []
  if (steps.length === 0) return 'response'
  if (steps.every(s => s.type === 'general')) return 'chat'
  return 'plan_executor'
}

function routeAfterExecutor(state) {
  if (state.has_failed_step) return 'response'
  if (state.needs_next_round) return 'evaluator'
  return 'response'
}

function routeAfterEvaluator(state) {
  const steps = state.plan?.steps || []
  if (steps.length === 0) return 'response'
  return 'announce'
}

async function announcePlan(state) {
  const { plan, onPlanReady } = state
  if (plan?.steps?.length) {
    const isOnlyGeneral = plan.steps.every(s => s.type === 'general')
    if (!isOnlyGeneral) {
      onPlanReady?.(plan)
    }
  }
  return {}
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const workflow = new StateGraph(AgentState)
  .addNode('router_planner', routerPlannerNode)
  .addNode('announce',       announcePlan)
  .addNode('plan_executor',  planExecutorNode)
  .addNode('chat',           chatNode)
  .addNode('response',       responseNode)
  .addNode('evaluator',      evaluatorNode)
  .addEdge(START, 'router_planner')
  .addEdge('router_planner', 'announce')
  .addConditionalEdges('announce', routeAfterRouter)
  .addConditionalEdges('plan_executor', routeAfterExecutor)
  .addConditionalEdges('evaluator', routeAfterEvaluator)

  // graph จบทันทีที่ตอบ user เสร็จ — memory รัน background หลัง graph
  .addEdge('chat',     END)
  .addEdge('response', END)

const compiled = workflow.compile()

// ── Public API ────────────────────────────────────────────────────────────────

export async function runAgent(params) {
  const {
    text, apiHistory, settings,
    deviceList,
    mqttClient, mqttRequestResponse,
    devicesRef, baseTopicRef, setDevices, handleSaveSettings,
    signal,
    lastCommand,
    chat_summary,
    pending_answer,
    onPlanReady, onStepStart, onStepResult, onStream, onInterimStatus, onComplete,
  } = params

  console.log(`\n[Agent] ← "${text?.slice(0, 120)}${(text?.length ?? 0) > 120 ? '...' : ''}"`)

  const raw = (apiHistory || []).map(m =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  )
  raw.push(new HumanMessage(text))

  const previousMessages = await trimMessages(raw, {
    maxTokens: 20000,
    tokenCounter: msgs => msgs.reduce((sum, m) => sum + Math.ceil(String(m.content).length / 3), 0),
    strategy: 'last',
    startOn: 'human',
    allowPartial: false,
  })

  let finalState
  try {
    finalState = await compiled.invoke({
      messages: previousMessages,
      settings,
      deviceList: deviceList ?? devicesRef,
      signal,
      mqttClient, mqttRequestResponse,
      devicesRef, baseTopicRef, setDevices, handleSaveSettings,
      lastCommand: lastCommand ?? null,
      onPlanReady, onStepStart, onStepResult, onStream, onInterimStatus,

      chat_summary:   chat_summary   ?? '',
      pending_answer: pending_answer ?? '',

      router_round: 0,
      needs_next_round: false,
      has_failed_step: false,
      failed_steps: [],
      completed: [],
    })
  } catch (err) {
    console.error('[Agent] fatal error:', err)
    const errorReply = 'ขอโทษนะคะ เกิดข้อผิดพลาดชั่วคราว กรุณาลองใหม่อีกครั้งค่ะ'
    onStream?.(errorReply)
    onComplete?.()
    return {
      reply: errorReply,
      lastCommand:    lastCommand    ?? null,
      chat_summary:   chat_summary   ?? '',
      pending_answer: pending_answer ?? '',
    }
  }

  const lastMsg = finalState.messages?.[finalState.messages.length - 1]
  const reply = lastMsg?.content || ''

  // graph จบแล้ว — แจ้ง UI ให้ finalize message ก่อน
  onComplete?.()

  // รัน memory หลังตอบ user เสร็จ (ไม่บล็อก visual)
  const memResult = await memoryCompressorNode(finalState)

  return {
    reply,
    lastCommand:    memResult.lastCommand    ?? finalState.lastCommand    ?? null,
    chat_summary:   memResult.chat_summary   ?? finalState.chat_summary   ?? '',
    pending_answer: memResult.pending_answer ?? finalState.pending_answer ?? '',
  }
}

export { detectAssistantName } from './helpers/detectAssistantName.js'
