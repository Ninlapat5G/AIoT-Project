// Main Agent — plan-based architecture
//
// Flow:
//   user → router_planner (LLM #1, วาง plan)
//            ├─ needs_clarify → clarify → END
//            ├─ all general   → chat (LLM #2) → END
//            └─ มี step ทำงาน → plan_executor → response (LLM #2) → END
//
// Callback ที่ส่งเข้ามา:
//   onPlanReady(plan)         — เรียกหลัง router_planner เสร็จ (ก่อน execute)
//   onStepStart(index)        — ก่อนแต่ละ step
//   onStepResult(index, res)  — หลังแต่ละ step  (res = {ok, summary})
//   onStream(chunk)           — ระหว่าง response/chat/clarify stream

import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, trimMessages } from '@langchain/core/messages'

import { routerPlannerNode } from './nodes/routerPlanner.js'
import { planExecutorNode }  from './nodes/planExecutor.js'
import { clarifyNode }       from './nodes/clarify.js'
import { chatNode }          from './nodes/chat.js'
import { responseNode }      from './nodes/response.js'

// ── State ─────────────────────────────────────────────────────────────────────

const AgentState = Annotation.Root({
  messages:        Annotation({ reducer: messagesStateReducer, default: () => [] }),
  settings:        Annotation(),
  deviceList:      Annotation(),
  signal:          Annotation(),

  // MQTT + React state binding (skill handler ใช้)
  mqttClient:      Annotation(),
  mqttWaitForStream: Annotation(),
  devicesRef:      Annotation(),
  baseTopicRef:    Annotation(),
  setDevices:      Annotation(),
  handleSaveSettings: Annotation(),

  // Callbacks ให้ UI
  onPlanReady:     Annotation(),
  onStepStart:     Annotation(),
  onStepResult:    Annotation(),
  onStream:        Annotation(),

  // ผลลัพธ์ขั้นกลาง
  plan:             Annotation({ reducer: (_, n) => n, default: () => null }),
  completed:        Annotation({ reducer: (_, n) => n, default: () => [] }),
  needs_clarify:    Annotation({ reducer: (_, n) => n, default: () => false }),
  clarify_question: Annotation({ reducer: (_, n) => n, default: () => '' }),
  lastCommand:      Annotation({ reducer: (_, n) => n, default: () => null }),
})

// ── Routing ───────────────────────────────────────────────────────────────────

function routeAfterRouter(state) {
  if (state.needs_clarify) return 'clarify'
  const steps = state.plan?.steps || []
  if (steps.length > 0 && steps.every(s => s.type === 'general')) return 'chat'
  if (steps.length === 0) return 'chat'
  return 'plan_executor'
}

// แตะ onPlanReady หลัง router เสร็จ (ก่อนเข้า path ถัดไป)
async function announcePlan(state) {
  const { plan, needs_clarify, onPlanReady } = state
  if (!needs_clarify && plan?.steps?.length) {
    onPlanReady?.(plan)
  }
  return {}
}

// ── Graph ─────────────────────────────────────────────────────────────────────

const workflow = new StateGraph(AgentState)
  .addNode('router_planner', routerPlannerNode)
  .addNode('announce',       announcePlan)
  .addNode('plan_executor',  planExecutorNode)
  .addNode('clarify',        clarifyNode)
  .addNode('chat',           chatNode)
  .addNode('response',       responseNode)
  .addEdge(START, 'router_planner')
  .addEdge('router_planner', 'announce')
  .addConditionalEdges('announce', routeAfterRouter)
  .addEdge('plan_executor', 'response')
  .addEdge('clarify',  END)
  .addEdge('chat',     END)
  .addEdge('response', END)

const compiled = workflow.compile()

// ── Public API ────────────────────────────────────────────────────────────────

export async function runAgent(params) {
  const {
    text, apiHistory, settings,
    deviceList,
    mqttClient, mqttWaitForStream,
    devicesRef, baseTopicRef, setDevices, handleSaveSettings,
    signal,
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
    onPlanReady, onStepStart, onStepResult, onStream,
  })

  const lastMsg = finalState.messages?.[finalState.messages.length - 1]
  const reply = lastMsg?.content || ''

  return { reply }
}

// Re-export ของเดิมที่ external module ใช้
export { detectAssistantName } from './helpers/detectAssistantName.js'
