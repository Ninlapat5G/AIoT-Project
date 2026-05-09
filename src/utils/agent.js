import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import {
  buildContextMessage,
  SEARCH_QUERY_PROMPT,
  DETECT_NAME_PROMPT,
  ROUND_SUMMARY_PROMPT,
} from "./agent_prompt.js";
import { DEFAULT_API_KEY } from "../config/default_key";

// ── 0. Helpers ────────────────────────────────────────────────────────────────
function nowString() {
  return new Date().toLocaleString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

const KG_TOOL = {
  type: "function",
  function: {
    name: "query_knowledge_graph",
    description: "ดึงข้อมูล devices ที่ active และ skills ที่เปิดอยู่ในขณะนี้จาก Knowledge Graph — เรียกเพื่อรู้ว่าสามารถทำอะไรได้บ้างในสภาพแวดล้อมปัจจุบัน",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["get_context"],
          description: "'get_context' — ดึง snapshot ของ active devices + enabled skills ณ ขณะนั้น"
        }
      },
      required: ["action"]
    }
  }
}

function buildLangChainTools(settings) {
  const skillTools = (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => ({
      type: "function",
      function: {
        name: sk.name,
        description: sk.description,
        parameters: JSON.parse(sk.schema || "{}")
      }
    }));
  return [KG_TOOL, ...skillTools];
}

// ── 1. State Definition ──────────────────────────────────────────────────────
const AgentState = Annotation.Root({
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  settings: Annotation(),
  deviceList: Annotation(),
  executeTool: Annotation(),
  onToolCall: Annotation(),
  onToolResult: Annotation(),
  onRoundSummary: Annotation(),
  onStream: Annotation(),
  signal: Annotation(),
  toolRound: Annotation({
    reducer: (curr, next) => next,
    default: () => 0,
  }),
  guardRetry: Annotation({
    reducer: (_, next) => next,
    default: () => false,
  }),
  postExecutor: Annotation({
    reducer: (_, next) => next,
    default: () => false,
  }),
  prevToolResults: Annotation(),
});

// ── 2. Nodes (Main Agent) ────────────────────────────────────────────────────

async function agentNode(state) {
  const { settings, deviceList, messages, signal } = state;

  // Filter devices by enabled skills.
  // Mapping: device.type → skill names that grant access
  //   digital / analog → mqtt_publish OR mqtt_read (either one is enough)
  //   hub              → hub
  // Add new entries here whenever a new device type / skill pair is introduced.
  const enabledSkills = new Set(
    (settings.skills || []).filter(s => s.enabled).map(s => s.name)
  )
  const deviceTypeAccess = {
    digital: ['mqtt_publish', 'mqtt_read'],
    analog:  ['mqtt_publish', 'mqtt_read'],
    hub:     ['hub'],
  }
  const visibleDevices = (deviceList || []).filter(d => {
    const required = deviceTypeAccess[d.type]
    // Unknown device types: always visible (future-proof)
    if (!required) return true
    return required.some(skill => enabledSkills.has(skill))
  })

  const effectiveKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: {
      apiKey: effectiveKey,
      baseURL: settings.endpoint,
      dangerouslyAllowBrowser: true
    },
    modelName: settings.model,
    temperature: 0.1,
  });

  const tools = buildLangChainTools(settings);
  const agent = tools.length > 0 ? llm.bindTools(tools) : llm;

  const personaMessage = new SystemMessage(
    settings.systemPrompt || "You are a helpful smart home assistant."
  );

  const contextMessage = new SystemMessage(
    buildContextMessage(nowString(), visibleDevices, settings.profile?.userBio || 'User')
  );

  const fullMessages = [personaMessage, contextMessage, ...messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal });
  for await (const chunk of stream) {
    if (!finalMessage) finalMessage = chunk;
    else finalMessage = finalMessage.concat(chunk);
  }

  return { messages: [finalMessage] };
}

async function toolNode(state) {
  const { messages, settings, executeTool, onToolCall, onToolResult, onRoundSummary, toolRound, signal } = state;
  const currentRound = toolRound + 1;

  const lastMessage = messages[messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];

  const collectedResults = [];

  const promises = toolCalls.map(async (tc) => {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args, signal);
    } catch (err) {
      result = { error: err.message || "Execution failed" };
    }
    onToolResult?.(tc.name, tc.args, result, currentRound);
    collectedResults.push({ name: tc.name, args: tc.args, result });

    return new ToolMessage({
      content: typeof result === "object" ? JSON.stringify(result) : String(result),
      name: tc.name,
      tool_call_id: tc.id
    });
  });

  const toolMessages = await Promise.all(promises);

  if (settings?.showToolDetails === false && onRoundSummary && collectedResults.length > 0) {
    // await ก่อน return — chip ต้อง appear ก่อนที่ next agentNode จะเริ่ม stream
    // ถ้า fire-and-forget (.then) จะเกิด race: round N+1 stream text ก่อน chip ปรากฏ
    const summary = await generateRoundSummary({ settings, tools: collectedResults, signal }).catch(() => null)
    if (summary) onRoundSummary(summary, currentRound)
  }

  return { messages: toolMessages, toolRound: currentRound };
}

// ── 3. Guard Node ────────────────────────────────────────────────────────────

const GUARD_PROMPT = `คุณคือ Guard Agent — ตรวจสอบว่า agent ตอบตามความจริงหรือหลอน
วิเคราะห์แล้วตอบ JSON:
- retry=true ถ้า: user ต้องการ action, agent บอกว่าทำสำเร็จแล้ว, แต่ไม่มี tool ถูกเรียกเลย
- retry=false ถ้า: tool ถูกเรียกแล้ว (ไม่ว่าสำเร็จหรือล้มเหลว) หรือเป็นแค่คำถาม/สนทนา
reason (เฉพาะตอน retry=true): ระบุว่าต้องเรียก tool อะไร กับ device อะไร เช่น "ต้องเรียก mqtt_publish เพื่อเปิดไฟหน้าบ้าน"`

async function guardNode(state) {
  const { messages, settings, deviceList, prevToolResults, signal } = state;

  const enabledSkills = new Set((settings.skills || []).filter(s => s.enabled).map(s => s.name));
  const deviceTypeAccess = { digital: ['mqtt_publish', 'mqtt_read'], analog: ['mqtt_publish', 'mqtt_read'], hub: ['hub'] };
  const visibleDevices = (deviceList || []).filter(d => {
    const required = deviceTypeAccess[d.type];
    return !required || required.some(skill => enabledSkills.has(skill));
  });

  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const turnMsgs = lastHumanIdx >= 0 ? messages.slice(lastHumanIdx) : messages;

  const userText  = messages[lastHumanIdx]?.content || '';
  const toolMsgs  = turnMsgs.filter(m => m instanceof ToolMessage);
  const draftMsg  = [...turnMsgs].reverse().find(m => m instanceof AIMessage && !m.tool_calls?.length);
  const draftText = draftMsg?.content || '';

  const toolsStr = toolMsgs.length > 0
    ? toolMsgs.map(m => `• ${m.name}: ${String(m.content).slice(0, 200)}`).join('\n')
    : 'ไม่มี';

  const input =
    `[Active Devices]\n${buildContextMessage(nowString(), visibleDevices, settings.profile?.userBio || 'User')}\n\n` +
    `${prevToolResults ? `[บริบทจาก turn ก่อน: ${prevToolResults}]\n` : ''}` +
    `คำสั่ง user: ${userText}\n` +
    `Tool ที่เรียกจริงใน turn นี้:\n${toolsStr}\n` +
    `Draft response ของ agent: "${draftText}"`;

  const effectiveKey = settings.apiKey || DEFAULT_API_KEY;
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
    maxTokens: 80,
  }).withStructuredOutput({
    type: 'object',
    properties: {
      retry:  { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['retry', 'reason'],
  });

  let retry = false, reason = '';
  try {
    const res = await llm.invoke(
      [new SystemMessage(GUARD_PROMPT), new HumanMessage(input)],
      { signal }
    );
    retry  = res.retry  ?? false;
    reason = res.reason ?? '';
  } catch {
    // ถ้า guard พัง ปล่อยผ่าน (ดีกว่า block user)
  }

  return {
    messages: retry ? [new SystemMessage(`[GUARD] ${reason} — กรุณาเรียก tool ให้ถูกต้อง`)] : [],
    guardRetry: retry,
  };
}

// ── 4. Executor Node (ตาม guard's instruction เท่านั้น) ──────────────────────

async function executorNode(state) {
  const { settings, deviceList, messages, signal } = state;

  const enabledSkills = new Set((settings.skills || []).filter(s => s.enabled).map(s => s.name));
  const deviceTypeAccess = { digital: ['mqtt_publish', 'mqtt_read'], analog: ['mqtt_publish', 'mqtt_read'], hub: ['hub'] };
  const visibleDevices = (deviceList || []).filter(d => {
    const required = deviceTypeAccess[d.type];
    return !required || required.some(skill => enabledSkills.has(skill));
  });

  const tools = buildLangChainTools(settings);
  if (tools.length === 0) return { postExecutor: true };

  const effectiveKey = settings.apiKey || DEFAULT_API_KEY;
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
  }).bindTools(tools);

  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const userText = messages[lastHumanIdx]?.content || '';

  const guardMsg = messages[messages.length - 1];
  const guardHint = (guardMsg instanceof SystemMessage && String(guardMsg.content).startsWith('[GUARD]'))
    ? '\n\n' + guardMsg.content
    : '';

  const result = await llm.invoke([
    new SystemMessage(
      buildContextMessage(nowString(), visibleDevices, settings.profile?.userBio || 'User') +
      '\n\nดำเนินการตามคำสั่งผู้ใช้ด้วยการเรียก tool ที่ถูกต้องทันที' + guardHint
    ),
    new HumanMessage(userText),
  ], { signal });

  return { messages: [result], postExecutor: true };
}

// ── 5. Responder Node (stream คำตอบสุดท้ายถึง user) ─────────────────────────

async function responderNode(state) {
  const { messages, settings, deviceList, signal, onStream } = state;

  const enabledSkills = new Set((settings.skills || []).filter(s => s.enabled).map(s => s.name));
  const deviceTypeAccess = { digital: ['mqtt_publish', 'mqtt_read'], analog: ['mqtt_publish', 'mqtt_read'], hub: ['hub'] };
  const visibleDevices = (deviceList || []).filter(d => {
    const required = deviceTypeAccess[d.type];
    return !required || required.some(skill => enabledSkills.has(skill));
  });

  // สร้าง message list สะอาด: ไม่รวม draft ที่อาจหลอน / [GUARD] / tool_call artifacts
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const userText = messages[lastHumanIdx]?.content || '';
  const turnMsgs = lastHumanIdx >= 0 ? messages.slice(lastHumanIdx) : messages;
  const toolMsgs = turnMsgs.filter(m => m instanceof ToolMessage);
  const cleanHistory = messages
    .slice(Math.max(0, lastHumanIdx - 6), lastHumanIdx)
    .filter(m => (m instanceof HumanMessage) || (m instanceof AIMessage && !m.tool_calls?.length && String(m.content).length > 0));

  const effectiveKey = settings.apiKey || DEFAULT_API_KEY;
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.3,
  });

  const fullMessages = [
    new SystemMessage(settings.systemPrompt || 'You are a helpful smart home assistant.'),
    new SystemMessage(buildContextMessage(nowString(), visibleDevices, settings.profile?.userBio || 'User')),
    ...cleanHistory,
    new HumanMessage(userText),
    ...toolMsgs,
  ];

  const stream = await llm.stream(fullMessages, { signal });
  let finalMsg;
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content);
    if (!finalMsg) finalMsg = chunk;
    else finalMsg = finalMsg.concat(chunk);
  }

  return { messages: [finalMsg ?? new AIMessage('ขออภัยค่ะ เกิดข้อผิดพลาด')] };
}

// ── 6. Graph ─────────────────────────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls?.length > 0) {
    if (state.toolRound >= 3) {
      console.warn("[Agent] Reached max tool rounds. Forcing exit.");
      return END;
    }
    return "tools";
  }
  return "guard";
}

const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("guard", guardNode)
  .addNode("executor", executorNode)
  .addNode("responder", responderNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addConditionalEdges("tools", state => state.postExecutor ? "responder" : "agent")
  .addConditionalEdges("guard", state => state.guardRetry ? "executor" : "responder")
  .addConditionalEdges("executor", state => {
    const last = state.messages[state.messages.length - 1];
    return last?.tool_calls?.length > 0 ? "tools" : "responder";
  })
  .addEdge("responder", END);

const compiledGraph = workflow.compile();

export const runAgent = async (params) => {
  const rawMessages = (params.apiHistory || []).map(m =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  );
  rawMessages.push(new HumanMessage(params.text));

  // Budget: 128K context − ~3,750 overhead − 1.5× Thai underestimate factor → safe at 20K
  const previousMessages = await trimMessages(rawMessages, {
    maxTokens: 20000,
    tokenCounter: msgs => msgs.reduce((sum, m) => sum + Math.ceil(String(m.content).length / 3), 0),
    strategy: 'last',
    startOn: 'human',
    allowPartial: false,
  });

  const finalState = await compiledGraph.invoke({
    ...params,
    messages: previousMessages,
    toolRound: 0,
    prevToolResults: params.prevToolResults ?? null,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply };
};

// ── 7. Sub-Agents ────────────────────────────────────────────────────────────

export async function generateSearchQuery({ settings, query, signal }) {
  const effectiveKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
  }).withStructuredOutput({
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optimized search query for web search engine' }
    },
    required: ['query']
  });

  const messages = [
    new SystemMessage(SEARCH_QUERY_PROMPT),
    new HumanMessage(`Raw query: "${query}"`)
  ];

  try {
    const response = await llm.invoke(messages, { signal });
    return response.query?.trim() || query;
  } catch {
    return query;
  }
}

export async function generateRoundSummary({ settings, tools, signal }) {
  const effectiveKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
    maxTokens: 60,
  });

  const input = tools.map(t =>
    `- ${t.name}(${JSON.stringify(t.args)}) → ${JSON.stringify(t.result).slice(0, 200)}`
  ).join('\n');

  try {
    const response = await llm.invoke([
      new SystemMessage(ROUND_SUMMARY_PROMPT),
      new HumanMessage(input)
    ], { signal });
    const content = typeof response.content === 'string' ? response.content : '';
    return content.trim() || tools.map(t => t.name).join(', ');
  } catch {
    return tools.map(t => t.name).join(', ');
  }
}

export async function detectAssistantName({ settings, systemPrompt, signal }) {
  const effectiveKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey: effectiveKey,
    configuration: { apiKey: effectiveKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0,
  }).withStructuredOutput({
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The AI assistant name, or empty string if not found' }
    },
    required: ['name']
  });

  const messages = [
    new SystemMessage(DETECT_NAME_PROMPT),
    new HumanMessage(`System prompt:\n${systemPrompt}`)
  ];

  const response = await llm.invoke(messages, { signal });
  return response.name?.trim() || null;
}
