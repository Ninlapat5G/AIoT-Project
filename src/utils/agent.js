import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, ToolMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import {
  buildContextMessage,
  IRONCLAD_RULES,
  SEARCH_QUERY_PROMPT,
  DETECT_NAME_PROMPT,
  ROUND_SUMMARY_PROMPT,
} from "./agent_prompt.js";
import {
  visibleDevices,
  findDeviceByTopic,
  describeDeviceState,
} from "./kg.js";
import { DEFAULT_API_KEY } from "../config/default_key";

// ── 0. Helpers ────────────────────────────────────────────────────────────────

// stable stringify: sort keys ก่อน → กัน {a,b} vs {b,a} เทียบกันไม่เจอ
function stableArgs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableArgs).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableArgs(v[k])).join(',') + '}';
}

function nowString() {
  // th-TH-u-ca-gregory: ใช้ label ไทย แต่ปียัง ค.ศ. (LLM ไม่งงกับ พ.ศ.)
  // timeZone: 'Asia/Bangkok' บังคับให้คงเส้นคงวาแม้ user อยู่ TZ อื่น
  return new Date().toLocaleString('th-TH-u-ca-gregory', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', timeZoneName: 'short',
  });
}

function makeLLM(settings, { temperature = 0.1, maxTokens, structured } = {}) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY;
  let llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
  });
  if (structured) llm = llm.withStructuredOutput(structured);
  return llm;
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
};

const INTENT_SKILLS = {
  home_control:  new Set(['mqtt_publish', 'mqtt_read', 'hub']),
  realtime_data: new Set(['web_search']),
  settings:      new Set(['manage_settings']),
  general:       new Set(),
};

function buildLangChainTools(settings, intents = null) {
  const allEnabled = (settings.skills || [])
    .filter(sk => sk.enabled)
    .map(sk => ({
      type: "function",
      function: {
        name: sk.name,
        description: sk.description,
        parameters: JSON.parse(sk.schema || "{}"),
      }
    }));

  if (!intents) return [KG_TOOL, ...allEnabled];

  const allowed = new Set(intents.flatMap(i => [...(INTENT_SKILLS[i] ?? new Set())]));
  return [KG_TOOL, ...allEnabled.filter(sk => allowed.has(sk.function.name))];
}

// สร้าง message ก้อนสถานะ KG (ใช้ใน node ที่ต้องเห็นบ้าน + อุปกรณ์)
function kgMessage(state) {
  const devices = visibleDevices(state.deviceList, state.settings);
  return new SystemMessage(
    buildContextMessage({ devices, settings: state.settings, now: nowString() })
  );
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
  // tool ที่ถูกเรียกในรอบล่าสุด (toolNode บันทึก) — guard ใช้ตรวจ
  // รูปแบบ: { name, args, result } | null
  lastToolCall: Annotation({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // device ที่เพิ่งสั่งใน turn นี้ — เซ็ตโดย toolNode หลัง mqtt_publish/hub
  lastCommandedDevice: Annotation({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // intent ที่ router จำแนกได้ — ใช้กรอง tools ใน agentNode
  intent: Annotation({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // งานที่เหลือต้องทำ — reflect เขียน, agent อ่านในรอบถัดไปผ่าน SystemMessage
  pendingTasks: Annotation({
    reducer: (_, next) => next,
    default: () => '',
  }),
  // reflect ตัดสินว่า done=true → ใช้ route ตรงไป responder ไม่ให้ agent วน
  reflectDone: Annotation({
    reducer: (_, next) => next,
    default: () => false,
  }),
});

// ── 2. Router Node ───────────────────────────────────────────────────────────
// จำแนก intent → agent ได้รับเฉพาะ tools ที่จำเป็น (web_search ไม่โผล่ถ้าไม่ต้องการ)

const ROUTER_PROMPT = `วิเคราะห์ความต้องการของ user แล้วระบุว่าต้องใช้ความสามารถใดบ้าง (เลือกได้มากกว่า 1)

home_control  — ควบคุม/ดูสถานะอุปกรณ์ในบ้าน
realtime_data — ข่าว / พยากรณ์อากาศ / ราคา (สินค้า หุ้น คริปโต) / เหตุการณ์ปัจจุบัน — เสมอ ไม่ว่า model จะรู้หรือไม่ก็ตาม หรือเมื่อ user สั่งให้ค้นหาจากอินเทอร์เน็ต
settings      — ดู/จัดการ settings, tools, skills ของระบบ
general       — อื่นๆ ทั้งหมด: code, อธิบาย, คำนวณ, สนทนาทั่วไป (ตอบจากความรู้ตัวเองได้)

ตอบ JSON: {"intents": [...]} — ถ้าตอบได้เองให้ใส่ ["general"]`;

async function routerNode(state) {
  const { messages, settings, signal } = state;
  const lastHuman = [...messages].reverse().find(m => m instanceof HumanMessage);
  const userText = lastHuman?.content || '';

  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 60,
    structured: {
      type: 'object',
      properties: {
        intents: {
          type: 'array',
          items: { type: 'string', enum: ['home_control', 'realtime_data', 'settings', 'general'] },
        },
      },
      required: ['intents'],
    },
  });

  try {
    const res = await llm.invoke(
      [new SystemMessage(ROUTER_PROMPT), new HumanMessage(userText)],
      { signal }
    );
    const intents = Array.isArray(res.intents) && res.intents.length ? res.intents : ['general'];
    return { intent: intents };
  } catch {
    return { intent: null }; // fallback: agent เห็น tools ทั้งหมด
  }
}

// ── 3. Agent Node ─────────────────────────────────────────────────────────────
// คนคิดหลัก: เห็น KG + กฎ + ประวัติ → ตัดสินใจเรียก tool หรือตอบ

async function agentNode(state) {
  const persona = new SystemMessage(
    state.settings.systemPrompt || "You are a helpful smart home assistant."
  );
  const rules = new SystemMessage(IRONCLAD_RULES);
  const kg    = kgMessage(state);

  const tools = buildLangChainTools(state.settings, state.intent);
  const llm   = makeLLM(state.settings, { temperature: 0 });
  const agent = tools.length > 0 ? llm.bindTools(tools) : llm;

  const fullMessages = [persona, rules, kg, ...state.messages];

  let finalMessage;
  const stream = await agent.stream(fullMessages, { signal: state.signal });
  for await (const chunk of stream) {
    finalMessage = finalMessage ? finalMessage.concat(chunk) : chunk;
  }

  return { messages: [finalMessage] };
}

// ── 3. Tool Node ──────────────────────────────────────────────────────────────
// รัน tool calls แบบ parallel + บันทึก lastToolCall / lastCommandedDevice

async function toolNode(state) {
  const { messages, settings, executeTool, onToolCall, onToolResult, onRoundSummary, toolRound, signal } = state;
  const currentRound = toolRound + 1;

  const lastMessage = messages[messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];
  const collected = [];

  const toolMessages = await Promise.all(toolCalls.map(async (tc) => {
    onToolCall?.(tc.name, tc.args, currentRound);
    let result;
    try {
      result = await executeTool(tc.name, tc.args, signal);
    } catch (err) {
      result = { error: err.message || "Execution failed" };
    }
    onToolResult?.(tc.name, tc.args, result, currentRound);
    collected.push({ name: tc.name, args: tc.args, result });

    return new ToolMessage({
      content: typeof result === "object" ? JSON.stringify(result) : String(result),
      name: tc.name,
      tool_call_id: tc.id,
    });
  }));

  // บันทึก tool call ตัวสุดท้ายใน batch (สำคัญต่อ guard) + device ที่ถูกสั่ง
  const stateUpdate = {
    messages: toolMessages,
    toolRound: currentRound,
    lastToolCall: collected[collected.length - 1] || null,
  };

  for (const call of collected) {
    let device = null, payload = null;
    if (call.name === 'mqtt_publish') {
      device  = findDeviceByTopic(state.deviceList, call.args?.topic);
      payload = call.args?.payload;
    } else if (call.name === 'hub') {
      device  = (state.deviceList || []).find(d => d.type === 'hub');
      payload = call.args?.task;
    }
    if (device) {
      stateUpdate.lastCommandedDevice = {
        name: device.name, room: device.room, type: device.type,
        pubTopic: device.pubTopic, payload,
      };
      break;
    }
  }

  // รอบสรุป (chip) — ถ้าผู้ใช้ปิด showToolDetails
  if (settings?.showToolDetails === false && onRoundSummary && collected.length > 0) {
    const summary = await generateRoundSummary({ settings, tools: collected, signal }).catch(() => null);
    if (summary) onRoundSummary(summary, currentRound);
  }

  // ดัก error ที่ลองซ้ำไม่มีประโยชน์ → ข้าม reflect ไปบอก user ทันที
  const STOP_HINTS = ['ห้ามเรียก', 'ห้ามลองซ้ำ', 'แจ้ง user ทันที'];
  const hasStopError = collected.some(c =>
    c.result?.error && STOP_HINTS.some(k => c.result.error.includes(k))
  );
  if (hasStopError) {
    stateUpdate.messages = [
      ...stateUpdate.messages,
      new SystemMessage('[STOP — tool error ที่ลองซ้ำไม่ได้ ให้รายงาน user ทันที]'),
    ];
    stateUpdate.reflectDone = true;
  }

  return stateUpdate;
}

// ── 3.5 Reflect Node ─────────────────────────────────────────────────────────
// คั่นระหว่าง tools → agent: ก่อนที่ agent จะวนรอบใหม่ ให้สรุปก่อนว่า
//   - turn นี้เรียก tool อะไรไปบ้าง ได้ผลอะไร
//   - ข้อมูลพอตอบ user หรือยัง / ยังขาดอะไร / ห้ามทำอะไรซ้ำ
// แล้ว inject เป็น SystemMessage ก่อนเข้า agentNode → กัน loop "เรียก tool เดิมแบบเปลี่ยน arg"

const REFLECT_PROMPT = `คุณคือ Reflection — ตรวจว่าคำสั่ง user ถูกทำครบหรือยัง

[กฎสำคัญ]
- ตรวจเฉพาะ device ที่มีอยู่ใน [KNOWLEDGE GRAPH] เท่านั้น — ห้ามคาดเดาว่าควรมี device อื่นนอกจากนี้
- คำว่า "ทุกห้อง" / "ทุกอุปกรณ์" หมายถึง device ทุกตัวที่อยู่ใน KG เท่านั้น ไม่ใช่ทุกห้องในโลก
- เทียบ pubTopic ใน tool calls กับ device ใน KG เพื่อดูว่า device ไหนถูกจัดการไปแล้ว

ตอบ JSON 3 field:

- done:
  • true  = tool ที่เรียกไปครอบคลุมคำสั่ง user แล้ว สำหรับ device ที่มีใน KG (รวมกรณีคำสั่งเป็นคำถาม + tool ให้คำตอบแล้ว)
  • false = ยังมี device ใน KG ที่ยังไม่ได้ทำ, tool ผิด, หรือ tool ล้มเหลว

- remaining: ประโยคเดียวบอกว่ายังเหลืออะไรที่ยังไม่ได้ทำ (เฉพาะ device ที่มีใน KG)
  • done=true → ""
  • done=false → บอกสั้นๆ เช่น "ยังไม่ได้ปิดแอร์ห้องนอน" หรือ "ขาดข้อมูลว่าห้องไหน"
  • ห้ามระบุชื่อ tool — บอกแค่ goal ให้ agent เลือก tool เอง
  • ห้ามใส่ task ที่ทำสำเร็จไปแล้วใน history

- thought: 1 ประโยคสรุปสำหรับ agent
  • done=true → ข้อความที่ agent เอาไปตอบ user ได้เลย เช่น "เปิดไฟห้องครัวให้แล้ว"
  • done=false → คำอธิบาย context สั้นๆ ว่าทำไมยังไม่จบ`;

async function reflectNode(state) {
  const { messages, settings, signal, deviceList } = state;

  // หา turn ปัจจุบัน
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { start = i; break; }
  }
  const userText = messages[start]?.content || '';

  // ประวัติก่อน turn นี้: เอาเฉพาะ user + AI text (ตัด tool internals ออก ประหยัด token)
  // เก็บ 6 entries ล่าสุด (~3 turn pair) — พอให้ resolve คำเช่น "ด้วย", "อันนั้น"
  const historyBefore = [];
  for (let i = 0; i < start; i++) {
    const m = messages[i];
    if (m instanceof HumanMessage) {
      historyBefore.push(`user: ${m.content}`);
    } else if (m instanceof AIMessage && !m.tool_calls?.length) {
      const content = typeof m.content === 'string' ? m.content : '';
      if (content) historyBefore.push(`assistant: ${content}`);
    }
  }
  const recentHistory = historyBefore.slice(-6);

  // tool calls + results ใน turn ปัจจุบัน
  const idToCall = new Map();
  const calls = [];
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (m instanceof AIMessage && m.tool_calls?.length) {
      for (const tc of m.tool_calls) idToCall.set(tc.id, { name: tc.name, args: tc.args });
    } else if (m instanceof ToolMessage) {
      const meta = idToCall.get(m.tool_call_id);
      if (meta) {
        const content = typeof m.content === 'string' ? m.content : String(m.content);
        calls.push({ ...meta, result: content.slice(0, 300) });
      }
    }
  }

  if (calls.length === 0) return {};

  const callsText = calls.map((c, i) =>
    `${i + 1}. ${c.name}(${JSON.stringify(c.args)}) → ${c.result}`
  ).join('\n');

  // KG snapshot — ให้ Reflect รู้ว่ามี device อะไรบ้างในบ้านจริงๆ
  const kg = buildContextMessage({
    devices: visibleDevices(deviceList, settings),
    settings,
    now: nowString(),
  });

  const input =
    (recentHistory.length ? `[ประวัติ chat ล่าสุด]\n${recentHistory.join('\n')}\n\n` : '') +
    `[คำสั่ง user (turn นี้)]\n"${userText}"\n\n` +
    `[Tool ที่เรียกไปแล้วใน turn นี้]\n${callsText}`;

  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 250,
    structured: {
      type: 'object',
      properties: {
        done: { type: 'boolean' },
        remaining: { type: 'string' },
        thought: { type: 'string' },
      },
      required: ['done', 'remaining', 'thought'],
    },
  });

  try {
    const res = await llm.invoke(
      [new SystemMessage(REFLECT_PROMPT), kg, new HumanMessage(input)],
      { signal }
    );

    const remaining = res.remaining?.trim() || '';
    const tag = res.done
      ? '[STOP — ตอบ user ทันที ห้ามเรียก tool อีก]'
      : '[REMAINING — ทำต่อ ห้ามทำซ้ำ action ที่อยู่ใน history]';

    const pendingText = remaining ? `\nยังเหลือ: ${remaining}` : '';

    return {
      messages: [new SystemMessage(`${tag} ${res.thought || ''}${pendingText}`)],
      pendingTasks: remaining,
      reflectDone: res.done === true,
    };
  } catch (err) {
    console.warn('[Reflect] failed, skipping:', err?.message);
    return {};
  }
}

// ── 4. Guard Node ────────────────────────────────────────────────────────────
// หน้าที่เดียว: ตรวจว่า "ที่ agent บอกว่าทำแล้ว ทำจริงและตรงกับที่ user สั่งไหม?"
// ดู 4 อย่าง: คำสั่ง user (turn นี้) + tool ล่าสุด + device ใน KG + draft text
// ไม่ดู turn ก่อนๆ — agent เข้าใจ context history เองอยู่แล้ว

const GUARD_PROMPT = `คุณคือ Guard — ตรวจสอบว่า agent ทำตามคำสั่ง user หรือเปล่า

ตอบ JSON:
- retry=true เมื่อ:
  • agent อ้างว่าทำ action สำเร็จ แต่ไม่มี tool ถูกเรียก (หลอน)
  • หรือ tool ที่เรียก/device ที่ถูกสั่ง ไม่ตรงกับสิ่งที่ user ขอ
- retry=false เมื่อ: tool ถูกเรียกถูก device ตรงกับคำสั่ง user (ไม่ว่าผลจะสำเร็จหรือล้มเหลว) หรือเป็นแค่คำถาม/สนทนา

reason (เฉพาะตอน retry=true): บอกว่าควรเรียก tool อะไร กับ device ไหน — สั้นๆ`;

async function guardNode(state) {
  const { messages, settings, lastToolCall, lastCommandedDevice, signal } = state;

  // 1. หา user message ล่าสุด (เฉพาะ turn นี้)
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const userText = messages[lastHumanIdx]?.content || '';

  // 2. หา draft message (AIMessage ตัวล่าสุดที่ไม่มี tool_calls)
  const draftMsg = [...messages].reverse().find(
    m => m instanceof AIMessage && !m.tool_calls?.length
  );
  const draftText = draftMsg?.content || '';

  // 3. สถานะ device ที่เพิ่งสั่ง (เทียบกับ KG ปัจจุบัน)
  const lcdSection = (() => {
    if (!lastCommandedDevice) return 'ไม่มี device ที่ถูกสั่งใน turn นี้';
    const current = (state.deviceList || []).find(d => d.pubTopic === lastCommandedDevice.pubTopic);
    const kgState = current ? describeDeviceState(current) : 'ไม่พบใน KG';
    return `${lastCommandedDevice.name} (${lastCommandedDevice.room}) | payload ที่ส่ง: ${lastCommandedDevice.payload} | KG ตอนนี้: ${kgState}`;
  })();

  // 4. tool call ล่าสุด
  const toolSection = lastToolCall
    ? `${lastToolCall.name}(${JSON.stringify(lastToolCall.args)}) → ${JSON.stringify(lastToolCall.result).slice(0, 200)}`
    : 'ไม่มี';

  const input =
    `[คำสั่ง user (turn นี้)]\n"${userText}"\n\n` +
    `[Tool ที่เรียกล่าสุด]\n${toolSection}\n\n` +
    `[Device ที่ถูกสั่ง]\n${lcdSection}\n\n` +
    `[Draft response ของ agent]\n"${draftText}"`;

  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 80,
    structured: {
      type: 'object',
      properties: {
        retry:  { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['retry', 'reason'],
    },
  });

  let retry = false, reason = '';
  try {
    const res = await llm.invoke(
      [new SystemMessage(GUARD_PROMPT), new HumanMessage(input)],
      { signal }
    );
    retry  = res.retry  ?? false;
    reason = res.reason ?? '';
  } catch (err) {
    // ถ้า guard พัง → ปล่อยผ่าน (ดีกว่า block user) แต่ log ไว้
    console.warn('[Guard] failed, passing through:', err?.message);
  }

  return {
    messages: retry ? [new SystemMessage(`[GUARD] ${reason} — กรุณาเรียก tool ให้ถูกต้อง`)] : [],
    guardRetry: retry,
  };
}

// ── 5. Executor Node — รัน tool ตาม guard hint ───────────────────────────────

async function executorNode(state) {
  const { settings, messages, signal } = state;

  const tools = buildLangChainTools(settings, ['home_control']);
  if (tools.length === 0) return { postExecutor: true };

  // หา user text ล่าสุด + guard hint
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const userText = messages[lastHumanIdx]?.content || '';

  const guardMsg = messages[messages.length - 1];
  const guardHint = (guardMsg instanceof SystemMessage && String(guardMsg.content).startsWith('[GUARD]'))
    ? '\n\n' + guardMsg.content
    : '';

  const llm = makeLLM(settings, { temperature: 0 }).bindTools(tools);

  const result = await llm.invoke([
    kgMessage(state),
    new SystemMessage('ดำเนินการตามคำสั่งผู้ใช้ด้วยการเรียก tool ที่ถูกต้องทันที' + guardHint),
    new HumanMessage(userText),
  ], { signal });

  return { messages: [result], postExecutor: true };
}

// ── 6. Responder Node — stream คำตอบสุดท้ายถึง user ──────────────────────────

async function responderNode(state) {
  const { messages, settings, signal, onStream } = state;

  // หา turn ปัจจุบัน + ตัด draft/[GUARD]/empty AI msgs ทิ้ง
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const turnMsgs = lastHumanIdx >= 0 ? messages.slice(lastHumanIdx) : messages;

  const cleanTurnMsgs = turnMsgs.filter(m =>
    m instanceof HumanMessage ||
    (m instanceof AIMessage && m.tool_calls?.length > 0) ||
    m instanceof ToolMessage
  );

  const cleanHistory = messages
    .slice(Math.max(0, lastHumanIdx - 6), lastHumanIdx)
    .filter(m =>
      (m instanceof HumanMessage) ||
      (m instanceof AIMessage && !m.tool_calls?.length && String(m.content).length > 0)
    );

  const llm = makeLLM(settings, { temperature: 0.3 });

  const fullMessages = [
    new SystemMessage(settings.systemPrompt || 'You are a helpful smart home assistant.'),
    kgMessage(state),
    ...cleanHistory,
    ...cleanTurnMsgs,
  ];

  const stream = await llm.stream(fullMessages, { signal });
  let finalMsg;
  for await (const chunk of stream) {
    if (chunk.content) onStream?.(chunk.content);
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk;
  }

  return { messages: [finalMsg ?? new AIMessage('ขออภัยค่ะ เกิดข้อผิดพลาด')] };
}

// ── 7. Graph Routing ─────────────────────────────────────────────────────────
// agent → tools (ถ้ามี tool_calls) → guard / responder
//
// Guard ทำงานเมื่อครบ 3 เงื่อนไข (AND):
//   1. lastCommandedDevice != null — มีประวัติสั่งอุปกรณ์ (เก็บตลอด session)
//   2. agent รอบนี้ไม่เรียก tool — implied จาก code path นี้
//   3. intent มี home_control — บริบท user เป็นการสั่งอุปกรณ์

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls?.length > 0) {
    if (state.toolRound >= 3) {
      console.warn("[Agent] Reached max tool rounds. Forcing exit.");
      return END;
    }

    // Safety net: ถ้า tool_calls ทุกตัวเหมือนเป๊ะกับที่เคยเรียกใน turn นี้ → บังคับ responder
    // กันเคสที่ reflect บอก continue แต่ agent ดื้อเรียก tool เดิม args เดิม
    const messages = state.messages;
    let turnStart = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i] instanceof HumanMessage) { turnStart = i; break; }
    }
    const priorKeys = new Set();
    for (let i = turnStart; i < messages.length - 1; i++) {
      const m = messages[i];
      if (m instanceof AIMessage && m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          priorKeys.add(`${tc.name}|${stableArgs(tc.args || {})}`);
        }
      }
    }
    const allDuplicate = priorKeys.size > 0 && lastMessage.tool_calls.every(tc =>
      priorKeys.has(`${tc.name}|${stableArgs(tc.args || {})}`)
    );
    if (allDuplicate) {
      console.warn('[Agent] R2 tool_calls identical to prior — forcing responder');
      return "responder";
    }

    return "tools";
  }

  const deviceHasHistory = state.lastCommandedDevice != null;
  const intentIsHomeControl = (state.intent || []).includes('home_control');

  return (deviceHasHistory && intentIsHomeControl) ? "guard" : "responder";
}

const workflow = new StateGraph(AgentState)
  .addNode("router", routerNode)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("reflect", reflectNode)
  .addNode("guard", guardNode)
  .addNode("executor", executorNode)
  .addNode("responder", responderNode)
  .addEdge(START, "router")
  .addEdge("router", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addConditionalEdges("tools", state => (state.postExecutor || state.reflectDone) ? "responder" : "reflect")
  .addConditionalEdges("reflect", state => state.reflectDone ? "responder" : "agent")
  .addConditionalEdges("guard", state => state.guardRetry ? "executor" : "responder")
  .addConditionalEdges("executor", state => {
    const last = state.messages[state.messages.length - 1];
    return last?.tool_calls?.length > 0 ? "tools" : "responder";
  })
  .addEdge("responder", END);

const compiledGraph = workflow.compile();

// ── 8. Public API ────────────────────────────────────────────────────────────

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
    lastToolCall: null,
    lastCommandedDevice: null,
    pendingTasks: '',
    reflectDone: false,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply, lastCommandedDevice: finalState.lastCommandedDevice ?? null };
};

// ── 9. Sub-Agents ────────────────────────────────────────────────────────────

export async function generateSearchQuery({ settings, query, signal }) {
  const llm = makeLLM(settings, {
    structured: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Optimized search query for web search engine' } },
      required: ['query'],
    },
  });

  try {
    const response = await llm.invoke([
      new SystemMessage(SEARCH_QUERY_PROMPT),
      new HumanMessage(`Raw query: "${query}"`),
    ], { signal });
    return response.query?.trim() || query;
  } catch {
    return query;
  }
}

export async function generateRoundSummary({ settings, tools, signal }) {
  const llm = makeLLM(settings, { maxTokens: 60 });

  const input = tools.map(t =>
    `- ${t.name}(${JSON.stringify(t.args)}) → ${JSON.stringify(t.result).slice(0, 200)}`
  ).join('\n');

  try {
    const response = await llm.invoke([
      new SystemMessage(ROUND_SUMMARY_PROMPT),
      new HumanMessage(input),
    ], { signal });
    const content = typeof response.content === 'string' ? response.content : '';
    return content.trim() || tools.map(t => t.name).join(', ');
  } catch {
    return tools.map(t => t.name).join(', ');
  }
}

export async function detectAssistantName({ settings, systemPrompt, signal }) {
  const llm = makeLLM(settings, {
    temperature: 0,
    structured: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The AI assistant name, or empty string if not found' } },
      required: ['name'],
    },
  });

  const response = await llm.invoke([
    new SystemMessage(DETECT_NAME_PROMPT),
    new HumanMessage(`System prompt:\n${systemPrompt}`),
  ], { signal });
  return response.name?.trim() || null;
}
