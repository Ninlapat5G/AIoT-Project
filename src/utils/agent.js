// ── LLM Client ────────────────────────────────────────────────────────────────
// Wraps fetch calls to any OpenAI-compatible endpoint.
// Swap endpoint/model by passing different settings — no other code changes needed.

function createLLMClient({ endpoint, apiKey, model }) {
  const url = `${endpoint}/chat/completions`
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  const mdl = model

  async function chat(messages, options = {}, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: mdl, messages, ...options }),
      signal
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)
    return res.json()
  }

  async function stream(messages, options = {}, onChunk, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: mdl, messages, stream: true, ...options }),
      signal
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) onChunk(delta)
        } catch { }
      }
    }
  }

  return { chat, stream }
}

// ── Mini Graph Engine ──────────────────────────────────────────────────────────
// LangGraph-inspired: nodes are async functions (state) => state.
// Edges are functions (state) => nextNodeName | null (null = END).

function createGraph({ nodes, edges, entry }) {
  return {
    async run(initialState) {
      let state = initialState
      let current = entry
      while (current) {
        const node = nodes[current]
        if (!node) throw new Error(`Agent graph: node "${current}" not found`)
        state = await node(state)
        current = edges[current]?.(state) ?? null
      }
      return state
    },
  }
}

// ── Agent Nodes ────────────────────────────────────────────────────────────────

async function routerNode(state) {
  const { text, settings, deviceList, signal } = state
  const llm = createLLMClient(settings)

  const tools = (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => {
      let parameters = { type: 'object', properties: {} }
      try { const p = JSON.parse(sk.schema); if (p?.type === 'object') parameters = p } catch { }
      return { type: 'function', function: { name: sk.name, description: sk.description, parameters } }
    })

  const systemPrompt = `You are an invisible IoT Routing Agent. Select tools to control or read devices.
RULES:
1. mqtt_publish: use the EXACT pubTopic from the device list — never shorten or invent topics.
2. Digital payload: exactly "true" or "false".
3. Analog payload: number string from "0" to the device's max value (see "max" field, default 255, may be 1023).
4. If no device action needed: respond "NO_TOOL_NEEDED" with no tool calls.
5. No conversational text — only tool calls or "NO_TOOL_NEEDED".

Available devices:
${JSON.stringify(deviceList, null, 2)}`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      { tools: tools.length ? tools : undefined, tool_choice: 'auto', temperature: 0.1, max_tokens: 4096 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Router returned no response from API')
  }

  const msg = data?.choices?.[0]?.message
  if (!msg) throw new Error('Router returned no response from API')

  return { ...state, toolCalls: msg.tool_calls || [] }
}

async function toolExecutorNode(state) {
  const { toolCalls, executeTool, onToolCall, onToolResult } = state
  const toolResults = []

  for (const tc of toolCalls) {
    const name = tc.function.name
    let args = {}
    try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = tc.function.arguments }

    onToolCall?.(name, args)
    await new Promise(r => setTimeout(r, 600)) // หน่วงให้ UI ดูสมูท

    let result
    try {
      // 🐛 มักแก้ตรงนี้: ครอบ try catch ให้ ตอนรัน tool ถ้าเกิดปัญหาจะได้ไม่พาบอทแครชไปเลย
      result = await executeTool(name, args)
    } catch (err) {
      console.error(`[Agent] Tool execution failed for ${name}:`, err)
      result = { error: err.message || "Execution failed" }
    }

    onToolResult?.(name, args, result)
    toolResults.push({ name, args, result })
  }

  return { ...state, toolResults }
}

async function responderNode(state) {
  const { text, settings, apiHistory, toolResults = [], deviceList, onStream, signal } = state
  const llm = createLLMClient(settings)

  const toolContext = toolResults.length
    ? toolResults.map(t => `Tool ${t.name}: ${JSON.stringify(t.result)}`).join('\n')
    : 'None — no tools were called'

  const stateSummary = toolResults.length
    ? (deviceList || [])
      .map(d => `- [${d.room}] ${d.name} (${d.type}): ${d.type === 'digital' ? (d.on ? 'ON' : 'OFF') : d.value}`)
      .join('\n') || 'No devices registered'
    : null

  const systemPrompt = `${settings.systemPrompt}

[User Info]
Name: "${settings.profile?.name || 'User'}"${stateSummary ? `

[Current Home Status]
${stateSummary}` : ''}

[Tool Execution Results]
${toolContext}`

  let reply = ''
  try {
    await llm.stream(
      [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
      { temperature: 0.7, max_tokens: 4096 },
      chunk => { reply += chunk; onStream?.(chunk) },
      signal
    )
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  }

  return { ...state, reply }
}

// ── Agent Graph ────────────────────────────────────────────────────────────────

const agentGraph = createGraph({
  nodes: {
    router: routerNode,
    toolExecutor: toolExecutorNode,
    responder: responderNode,
  },
  edges: {
    router: state => state.toolCalls.length > 0 ? 'toolExecutor' : 'responder',
    toolExecutor: () => 'responder',
  },
  entry: 'router',
})

// ── Public API ─────────────────────────────────────────────────────────────────
// params: { text, settings, deviceList, apiHistory, executeTool, onStream, onToolCall, onToolResult, signal }
// returns: { ...state, reply }

export const runAgent = params => agentGraph.run({ toolCalls: [], toolResults: [], ...params })