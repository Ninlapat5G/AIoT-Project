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

// ── Tools Helper ───────────────────────────────────────────────────────────────
function buildTools(settings) {
  return (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => {
      let parameters = { type: 'object', properties: {} }
      try { const p = JSON.parse(sk.schema); if (p?.type === 'object') parameters = p } catch { }
      return { type: 'function', function: { name: sk.name, description: sk.description, parameters } }
    })
}

// ── Agent Nodes ────────────────────────────────────────────────────────────────

async function routerNode(state) {
  const { text, settings, deviceList, signal } = state
  const llm = createLLMClient(settings)
  const tools = buildTools(settings)

  const systemPrompt = `You are an invisible IoT Routing Agent. Select tools to control or read devices.
RULES:
1. mqtt_publish: use the EXACT pubTopic from the device list — never shorten or invent topics.
2. Digital payload: exactly "true" or "false".
3. Analog payload: number string from "0" to the device's max value (see "max" field, default 255, may be 1023).
4. os_command: set instruction = user's exact request, os = device's "os" field, topic = device's pubTopic. Only call when an os_terminal device exists. Set wait_output: true only for commands that produce output (dir, ls, cat, pwd, ipconfig, etc.) — false for fire-and-forget (shutdown, reboot, open app, kill process, etc.).
5. web_search: use when the user asks for real-world information, current events, news, weather, facts, definitions, prices, or anything outside the smart home device context. Write a precise, concise query — use English for broader results unless the user explicitly asks for Thai-language sources. You may combine web_search with device tools in one response (e.g. search weather → set thermostat).
6. If no tool is needed: respond "NO_TOOL_NEEDED" with no tool calls.
7. No conversational text — only tool calls or "NO_TOOL_NEEDED".

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

async function plannerNode(state) {
  const { text, settings, deviceList, allToolResults, toolRound, signal } = state
  const llm = createLLMClient(settings)
  const tools = buildTools(settings)

  const systemPrompt = `You are a Reactive Planner. You have just received tool results from round ${toolRound}.
Based on the original user request and these results, decide if further tool calls are needed.

RULES:
1. If the results are sufficient to answer the user → respond "DONE" with no tool calls.
2. If a follow-up action is clearly needed based on the results (e.g. got weather data → now set a device) → return tool calls.
3. Never repeat a tool call that was already made.
4. No conversational text — only tool calls or "DONE".

Original request: "${text}"

Tool results so far:
${JSON.stringify(allToolResults, null, 2)}

Available devices:
${JSON.stringify(deviceList, null, 2)}`

  let data
  try {
    data = await llm.chat(
      [{ role: 'system', content: systemPrompt }],
      { tools: tools.length ? tools : undefined, tool_choice: 'auto', temperature: 0.1, max_tokens: 1024 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('Planner returned no response from API')
  }

  const msg = data?.choices?.[0]?.message
  return { ...state, toolCalls: msg?.tool_calls || [] }
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
      result = await executeTool(name, args)
    } catch (err) {
      console.error(`[Agent] Tool execution failed for ${name}:`, err)
      result = { error: err.message || "Execution failed" }
    }

    onToolResult?.(name, args, result)
    toolResults.push({ name, args, result })
  }

  return {
    ...state,
    toolResults,
    allToolResults: [...(state.allToolResults || []), ...toolResults],
    toolRound: (state.toolRound || 0) + 1,
  }
}

async function responderNode(state) {
  const { text, settings, apiHistory, allToolResults = [], deviceList, onStream, signal } = state
  const llm = createLLMClient(settings)

  const toolContext = allToolResults.length
    ? allToolResults.map(t => `Tool ${t.name}: ${JSON.stringify(t.result)}`).join('\n')
    : 'None — no tools were called'

  const stateSummary = allToolResults.length
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

  await llm.stream(
    [{ role: 'system', content: systemPrompt }, ...apiHistory, { role: 'user', content: text }],
    { temperature: 0.7, max_tokens: 4096 },
    chunk => { reply += chunk; onStream?.(chunk) },
    signal
  )

  return { ...state, reply }
}

// ── Agent Graph ────────────────────────────────────────────────────────────────

const agentGraph = createGraph({
  nodes: {
    router: routerNode,
    toolExecutor: toolExecutorNode,
    planner: plannerNode,
    responder: responderNode,
  },
  edges: {
    router: state => state.toolCalls.length > 0 ? 'toolExecutor' : 'responder',
    toolExecutor: () => 'planner',
    planner: state => (state.toolCalls.length > 0 && state.toolRound < 2) ? 'toolExecutor' : 'responder',
  },
  entry: 'router',
})

// ── Public API ─────────────────────────────────────────────────────────────────
// params: { text, settings, deviceList, apiHistory, executeTool, onStream, onToolCall, onToolResult, signal }
// returns: { ...state, reply }

export const runAgent = params => agentGraph.run({
  toolCalls: [],
  toolResults: [],
  allToolResults: [],
  toolRound: 0,
  ...params
})

// ── OS Command Generator ───────────────────────────────────────────────────────
// Translates a natural-language instruction into an exact terminal command.
// Returns the raw command string, or throws if the instruction is unsafe/empty.

const OS_COMMAND_SYSTEM = `You are a terminal command translator for remote machine control via MQTT.
Convert the user's instruction into the exact terminal command for the target OS.

Output rules:
- Return ONLY the raw command string — no explanation, no markdown, no code fences, no quotes
- Single command per response (pipelines allowed only when necessary)

Safety:
- If the instruction would destroy system files, format drives, or wipe data → respond with exactly: UNSAFE

Command syntax by OS:
- windows → Command Prompt (cmd.exe); use PowerShell only if explicitly requested
- mac     → bash / zsh
- linux   → POSIX sh / bash`

export async function generateOsCommand({ settings, instruction, os, signal }) {
  const llm = createLLMClient(settings)
  let data
  try {
    data = await llm.chat(
      [
        { role: 'system', content: `${OS_COMMAND_SYSTEM}\n\nTarget OS: ${os}` },
        { role: 'user', content: instruction },
      ],
      { temperature: 0, max_tokens: 256 },
      signal
    )
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error('OS command agent ไม่ตอบสนอง')
  }
  const cmd = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!cmd) throw new Error('ไม่สามารถสร้างคำสั่งได้')
  if (cmd === 'UNSAFE') throw new Error('คำสั่งนี้ไม่ปลอดภัย — ปฏิเสธการรัน')
  return cmd
}