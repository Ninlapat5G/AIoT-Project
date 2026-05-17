import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, trimMessages } from '@langchain/core/messages'

import { routerPlannerNode } from './nodes/routerPlanner.js'
import { planExecutorNode }  from './nodes/planExecutor.js'
import { clarifyNode }       from './nodes/clarify.js'
import { chatNode }          from './nodes/chat.js'
import { responseNode }      from './nodes/response.js'
import { synthesizerNode }   from './nodes/synthesizer.js'
import { memoryCompressorNode } from './nodes/memoryCompressor.js'

// ── State ─────────────────────────────────────────────────────────────────────

const appendArray = (curr, next) => [...(curr || []), ...(next || [])]

const AgentState = Annotation.Root({
  messages:        Annotation({ reducer: messagesStateReducer, default: () => [] }),
  settings:        Annotation(),
  deviceList:      Annotation(),
  signal:          Annotation(),

  mqttClient:      Annotation(),
  mqttWaitForStream: Annotation(),
  devicesRef:      Annotation(),
  baseTopicRef:    Annotation(),
  setDevices:      Annotation(),
  handleSaveSettings: Annotation(),

  onPlanReady:     Annotation(),
  onStepStart:     Annotation(),
  onStepResult:    Annotation(),
  onStream:        Annotation(),

  plan:             Annotation({ reducer: (_, n) => n, default: () => null }),
  // completed: append ข้ามรอบของ multi-router ภายใน turn เดียว (reset ใน runAgent ทุก turn)
  completed:        Annotation({ reducer: appendArray, default: () => [] }),
  needs_clarify:    Annotation({ reducer: (_, n) => n, default: () => false }),
  clarify_question: Annotation({ reducer: (_, n) => n, default: () => '' }),
  lastCommand:      Annotation({ reducer: (_, n) => n, default: () => null }),

  // multi-router state
  router_round:       Annotation({ reducer: (_, n) => n, default: () => 0 }),
  max_router_rounds:  Annotation({ reducer: (_, n) => n, default: () => 2 }),
  needs_next_round:   Annotation({ reducer: (_, n) => n, default: () => false }),
  router_context:     Annotation({ reducer: (_, n) => n, default: () => '' }),

  // executor failure tracking
  has_failed_step: Annotation({ reducer: (_, n) => n, default: () => false }),
  failed_steps:    Annotation({ reducer: appendArray, default: () => [] }),

  // carry-over ข้าม turn — ส่งกลับ caller แล้วป้อนเข้ามาใหม่ turn ถัดไป
  wait_retry:      Annotation({ reducer: (_, n) => n, default: () => '' }),
  pending_clarify: Annotation({ reducer: (_, n) => n, default: () => '' }),

  // state สำหรับ memory_compressor — เก็บสรุปและ history ที่บีบอัดแล้ว
  chat_summary:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  optimizedHistory: Annotation({ reducer: (_, n) => n, default: () => [] }),
})

// ── Routing ───────────────────────────────────────────────────────────────────

function routeAfterRouter(state) {
  if (state.needs_clarify) return 'clarify'
  const steps = state.plan?.steps || []
  if (steps.length > 0 && steps.every(s => s.type === 'general')) return 'chat'
  if (steps.length === 0) return state.needs_next_round ? 'synthesizer' : 'response'
  return 'plan_executor'
}

function routeAfterExecutor(state) {
  if (state.has_failed_step) return 'response'  // ตัดวงจร multi-router — แจ้ง user
  if (state.needs_next_round && state.router_round < state.max_router_rounds) {
    return 'synthesizer'
  }
  return 'response'
}

async function announcePlan(state) {
  const { plan, needs_clarify, onPlanReady } = state
  if (!needs_clarify && plan?.steps?.length) {
    // ข้ามการแจ้ง plan ถ้ามีแต่ step ประเภท general — ผู้ใช้ไม่ต้องเห็น Tool Pill เปล่า
    const isOnlyGeneral = plan.steps.every(s => s.type === 'general')
    if (!isOnlyGeneral) {
      onPlanReady?.(plan)
    }
  }
  return {}
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const workflow = new StateGraph(AgentState)
  .addNode('router_planner',    routerPlannerNode)
  .addNode('announce',          announcePlan)
  .addNode('plan_executor',     planExecutorNode)
  .addNode('clarify',           clarifyNode)
  .addNode('chat',              chatNode)
  .addNode('response',          responseNode)
  .addNode('synthesizer',       synthesizerNode)
  .addNode('memory_compressor', memoryCompressorNode)
  .addEdge(START, 'router_planner')
  .addEdge('router_planner', 'announce')
  .addConditionalEdges('announce', routeAfterRouter)
  .addConditionalEdges('plan_executor', routeAfterExecutor)
  .addEdge('synthesizer', 'router_planner')

  // ทุก path ก่อนจบจะผ่าน memory_compressor เพื่อบีบประวัติแชทไว้ใช้รอบถัดไป
  .addEdge('clarify',           'memory_compressor')
  .addEdge('chat',              'memory_compressor')
  .addEdge('response',          'memory_compressor')
  .addEdge('memory_compressor', END)

const compiled = workflow.compile()

// ── Public API ────────────────────────────────────────────────────────────────

export async function runAgent(params) {
  const {
    text, apiHistory, settings,
    deviceList,
    mqttClient, mqttWaitForStream,
    devicesRef, baseTopicRef, setDevices, handleSaveSettings,
    signal,
    lastCommand,
    wait_retry,
    pending_clarify,
    maxRouterRounds,
    onPlanReady, onStepStart, onStepResult, onStream,
  } = params

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

  const finalState = await compiled.invoke({
    messages: previousMessages,
    settings,
    deviceList: deviceList ?? devicesRef,
    signal,
    mqttClient, mqttWaitForStream,
    devicesRef, baseTopicRef, setDevices, handleSaveSettings,
    lastCommand: lastCommand ?? null,
    onPlanReady, onStepStart, onStepResult, onStream,
    chat_summary: '',
    optimizedHistory: [],

    router_round: 0,
    max_router_rounds: maxRouterRounds ?? 2,
    needs_next_round: false,
    router_context: '',
    has_failed_step: false,
    failed_steps: [],
    completed: [],

    wait_retry: wait_retry ?? '',
    pending_clarify: pending_clarify ?? '',
  })

  const lastMsg = finalState.messages?.[finalState.messages.length - 1]
  const reply = lastMsg?.content || ''

  return {
    reply,
    lastCommand: finalState.lastCommand ?? null,
    optimizedHistory: finalState.optimizedHistory ?? [],
    wait_retry: finalState.wait_retry ?? '',
    pending_clarify: finalState.pending_clarify ?? '',
  }
}

export { detectAssistantName } from './helpers/detectAssistantName.js'
