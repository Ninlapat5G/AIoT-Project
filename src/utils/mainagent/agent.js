import { StateGraph, START, END, Annotation, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, trimMessages } from '@langchain/core/messages'

import { routerPlannerNode } from './nodes/routerPlanner.js'
import { planExecutorNode }  from './nodes/planExecutor.js'
import { clarifyNode }       from './nodes/clarify.js'
import { chatNode }          from './nodes/chat.js'
import { responseNode }      from './nodes/response.js'
import { memoryCompressorNode } from './nodes/memoryCompressor.js'

// ── State ─────────────────────────────────────────────────────────────────────

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
  completed:        Annotation({ reducer: (_, n) => n, default: () => [] }),
  needs_clarify:    Annotation({ reducer: (_, n) => n, default: () => false }),
  clarify_question: Annotation({ reducer: (_, n) => n, default: () => '' }),
  lastCommand:      Annotation({ reducer: (_, n) => n, default: () => null }),
  
  // เพิ่มตัวแปรสำหรับรับรองระบบบีบอัดหน่วยความจำ
  chat_summary:     Annotation({ reducer: (_, n) => n, default: () => '' }),
  optimizedHistory: Annotation({ reducer: (_, n) => n, default: () => [] }),
})

// ── Routing ───────────────────────────────────────────────────────────────────

function routeAfterRouter(state) {
  if (state.needs_clarify) return 'clarify'
  const steps = state.plan?.steps || []
  if (steps.length > 0 && steps.every(s => s.type === 'general')) return 'chat'
  if (steps.length === 0) return 'chat'
  return 'plan_executor'
}

async function announcePlan(state) {
  const { plan, needs_clarify, onPlanReady } = state
  if (!needs_clarify && plan?.steps?.length) {
    onPlanReady?.(plan)
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
  .addNode('memory_compressor', memoryCompressorNode) // ปลั๊กโหนดบีบความจำเพิ่มท้ายขบวน
  .addEdge(START, 'router_planner')
  .addEdge('router_planner', 'announce')
  .addConditionalEdges('announce', routeAfterRouter)
  .addEdge('plan_executor', 'response')
  
  // ลากท่อปลายทางทั้งหมดเข้าสู่ตัวคัดกรองหน่วยความจำก่อนจบ Turn แบบ Single Source of Truth
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
  })

  const lastMsg = finalState.messages?.[finalState.messages.length - 1]
  const reply = lastMsg?.content || ''

  return { 
    reply, 
    lastCommand: finalState.lastCommand ?? null,
    optimizedHistory: finalState.optimizedHistory ?? [] // คืนประวัติที่บีบอัดแล้วให้ตัวแปรแชทสเตทภายนอกไปบันทึกรอบถัดไป
  }
}

export { detectAssistantName } from './helpers/detectAssistantName.js'