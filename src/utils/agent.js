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
  guardDone: Annotation({
    reducer: (_, next) => next,
    default: () => false,
  }),
  prevToolResults: Annotation(),
});

// ── 2. Nodes (Main Agent) ────────────────────────────────────────────────────

async function agentNode(state) {
  const { settings, deviceList, messages, signal, onStream, toolRound, guardDone } = state;

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

    // stream เฉพาะ response สุดท้าย (หลัง guard ฉีด REALITY CHECK แล้ว)
    if (chunk.content && !chunk.tool_call_chunks?.length && guardDone) {
      onStream?.(chunk.content);
    }
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

const GUARD_PROMPT = `คุณคือ Guard Agent — วิเคราะห์ว่า response ที่ agent กำลังจะตอบนั้นตรงกับความจริงไหม

ดูข้อมูลที่ให้มาแล้วสรุป 1-2 ประโยคสั้นๆ:
- ถ้าคำสั่งต้องการ action แต่ไม่มี tool ถูกเรียก → บอกว่ายังไม่ได้ดำเนินการจริง
- ถ้า tool ถูกเรียกแล้วสำเร็จ → ยืนยันสั้นๆ ว่าทำอะไรไปบ้าง
- ถ้า tool ล้มเหลว → บอกว่าล้มเหลวและสาเหตุ
- ถ้าเป็นแค่คำถามหรือสนทนา ไม่ต้อง action → บอกว่าไม่ต้องดำเนินการ
ตอบเป็นข้อเท็จจริงสั้นๆ ไม่ต้องแนะนำว่าควรพูดอะไร`

async function guardNode(state) {
  const { messages, settings, prevToolResults, signal } = state;

  // แยก messages ของ turn นี้ออกมา
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const turnMsgs = lastHumanIdx >= 0 ? messages.slice(lastHumanIdx) : messages;

  const userText   = messages[lastHumanIdx]?.content || '';
  const toolMsgs   = turnMsgs.filter(m => m instanceof ToolMessage);
  const draftMsg   = [...turnMsgs].reverse().find(m => m instanceof AIMessage && !m.tool_calls?.length);
  const draftText  = draftMsg?.content || '';

  const toolsStr = toolMsgs.length > 0
    ? toolMsgs.map(m => `• ${m.name}: ${String(m.content).slice(0, 200)}`).join('\n')
    : 'ไม่มี';

  const input =
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
  });

  let verdict;
  try {
    const res = await llm.invoke(
      [new SystemMessage(GUARD_PROMPT), new HumanMessage(input)],
      { signal }
    );
    verdict = typeof res.content === 'string' ? res.content.trim() : toolsStr;
  } catch {
    verdict = toolMsgs.length > 0 ? toolsStr : 'ไม่มีการดำเนินการใดๆ';
  }

  return {
    messages: [new SystemMessage(`[REALITY CHECK]\n${verdict}`)],
    guardDone: true,
  };
}

// ── 4. Graph Logic (ReAct Loop) ──────────────────────────────────────────────

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls?.length > 0) {
    if (state.toolRound >= 3) {
      console.warn("[Agent] Reached max tool rounds. Forcing exit.");
      return END;
    }
    return "tools";
  }
  if (!state.guardDone) return "guard";
  return END;
}

const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("guard", guardNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .addEdge("guard", "agent");

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
    guardDone: false,
    prevToolResults: params.prevToolResults ?? null,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply };
};

// ── 4. Sub-Agents ────────────────────────────────────────────────────────────

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
