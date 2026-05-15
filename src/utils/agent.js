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

// อ่าน deviceList แบบ live — รับได้ทั้ง React ref ({current: [...]}) และ plain array
function getDevices(state) {
  const dl = state.deviceList;
  return (dl?.current ?? dl) || [];
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
  home_control:  new Set(['mqtt_publish', 'hub']),
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
  const devices = visibleDevices(getDevices(state), state.settings);
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
  // guard verdict: pass | retry_tool | retry_text | null (null = ยังไม่เคยตรวจ)
  // ใช้เป็น flag ด้วย: ถ้า set แล้ว → ผ่าน guard มาแล้ว → responder ครั้งถัดไป stream ตรง
  guardVerdict: Annotation({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // hint จาก guard ส่งเข้า responder ตอน regen (กรณี retry_text)
  guardHintForResponder: Annotation({
    reducer: (_, next) => next,
    default: () => null,
  }),
  // buffer ของ responder ที่ยังไม่ stream ออก — guard ตรวจก่อน
  responderBuffer: Annotation({
    reducer: (_, next) => next,
    default: () => null,
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
  // device ล่าสุดที่ถูกสั่งใน session — เซ็ตโดย toolNode หลัง mqtt_publish/hub
  // ส่งกลับเข้า runAgent ทุก turn ผ่าน useChat ref → guard ใช้เทียบกับ KG ปัจจุบัน
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

// ── 4. Tool Node ──────────────────────────────────────────────────────────────
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
      device  = findDeviceByTopic(getDevices(state), call.args?.topic);
      payload = call.args?.payload;
    } else if (call.name === 'hub') {
      device  = getDevices(state).find(d => d.type === 'hub');
      payload = call.args?.task;
    }
    if (device) {
      stateUpdate.lastCommandedDevice = {
        name: device.name, room: device.room, type: device.type,
        topic: device.topic, payload,
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

// ── 5. Reflect Node ──────────────────────────────────────────────────────────
// คั่นระหว่าง tools → agent: ก่อนที่ agent จะวนรอบใหม่ ให้สรุปก่อนว่า
//   - turn นี้เรียก tool อะไรไปบ้าง ได้ผลอะไร
//   - ข้อมูลพอตอบ user หรือยัง / ยังขาดอะไร / ห้ามทำอะไรซ้ำ
// แล้ว inject เป็น SystemMessage ก่อนเข้า agentNode → กัน loop "เรียก tool เดิมแบบเปลี่ยน arg"

const REFLECT_PROMPT = `คุณคือ Reflection — ตรวจว่าคำสั่ง user ถูกทำครบหรือยัง

[กฎสำคัญ]
- ตรวจเฉพาะ device ที่มีอยู่ใน [KNOWLEDGE GRAPH] เท่านั้น — ไม่มี device อื่นนอกจากนี้
- คำว่า "ทุกห้อง" / "ทุกอุปกรณ์" หมายถึง device ทุกตัวที่อยู่ใน KG เท่านั้น
- เทียบ topic ใน tool calls กับ device ใน KG เพื่อดูว่า device ไหนถูกจัดการไปแล้ว
- ถ้า remaining จะระบุ device ที่ไม่มีใน KG → ให้ตั้ง done=true ทันที เพราะ device นั้นไม่มีในระบบ

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
  const { messages, settings, signal } = state;
  const deviceList = getDevices(state);

  // หา turn ปัจจุบัน
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { start = i; break; }
  }
  const userText = messages[start]?.content || '';

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

  const kg = new SystemMessage(buildContextMessage({
    devices: visibleDevices(deviceList, settings),
    settings,
    now: nowString(),
  }));

  const input =
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

    let done = res.done === true;
    let remaining = res.remaining?.trim() || '';

    // guard: ถ้า remaining พูดถึง device ที่ไม่มีใน KG เลย → force done=true
    if (!done && remaining) {
      const kgNames = (deviceList || []).map(d => d.name);
      if (kgNames.length > 0 && !kgNames.some(name => remaining.includes(name))) {
        done = true;
        remaining = '';
      }
    }

    const tag = done
      ? '[STOP — ตอบ user ทันที ห้ามเรียก tool อีก]'
      : '[REMAINING — ทำต่อ ห้ามทำซ้ำ action ที่อยู่ใน history]';

    const pendingText = remaining ? `\nยังเหลือ: ${remaining}` : '';

    return {
      messages: [new SystemMessage(`${tag} ${res.thought || ''}${pendingText}`)],
      pendingTasks: remaining,
      reflectDone: done,
    };
  } catch (err) {
    console.warn('[Reflect] failed, skipping:', err?.message);
    return {};
  }
}

// ── 6. Guard Node ────────────────────────────────────────────────────────────
// ย้ายมาหลัง responder — ตรวจข้อความที่ user จะเห็นจริง ๆ ไม่ใช่ draft ของ agent
// Verdict 3 ทาง: pass | retry_tool | retry_text

const GUARD_PROMPT = `คุณคือ Guard — ตรวจว่า "ข้อความที่ responder จะส่งให้ user" สอดคล้องกับ "สิ่งที่ระบบทำจริง" หรือไม่

[ข้อมูลที่คุณได้รับ]
1. คำสั่ง user
2. Tool calls ที่เรียกไปแล้ว + ผลลัพธ์จริง
3. Device states ใน KG ปัจจุบัน
4. Responder text — ข้อความที่ user จะเห็น

[ตอบ JSON 2 field]
- verdict:
  • "pass"        = responder text ตรงกับสิ่งที่เกิดขึ้นจริง (หรือเป็นแค่สนทนา ไม่ได้อ้างทำอะไร)
  • "retry_tool"  = responder อ้างทำ action แต่ tool ไม่ได้เรียก หรือเรียกผิด device → ต้องสั่ง tool ใหม่
  • "retry_text"  = tool ทำงานถูกต้องแล้ว แต่ responder รายงานผิด (เช่น tool success แต่ responder บอก "ไม่สำเร็จ", หรือ tool คืนข้อมูล แต่ responder ปฏิเสธว่าไม่รู้) → แค่ regen ข้อความ ไม่ต้องเรียก tool

- reason: 1 ประโยคสั้น
  • retry_tool → บอกว่าควรเรียก tool อะไร กับ device ไหน
  • retry_text → บอกว่า responder ผิดตรงไหน
  • pass → ""

[หลักสำคัญ]
- ถ้า user แค่ถาม/สนทนาและ responder ตอบตามข้อมูลที่มี → pass
- ถ้า tool result มี success=true ครอบคลุมคำสั่ง user แล้ว แต่ responder บอกไม่สำเร็จ → retry_text
- ถ้า user สั่งให้ทำ action แต่ไม่มี tool ถูกเรียกเลย → retry_tool`;

async function guardNode(state) {
  const { messages, settings, lastCommandedDevice, responderBuffer, signal } = state;

  // 1. user message ล่าสุด
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) { lastHumanIdx = i; break; }
  }
  const userText = messages[lastHumanIdx]?.content || '';

  // 2. responder text ที่จะส่งให้ user (ของจริง)
  const responderText = responderBuffer?.text || '';

  // 3. tool calls ทั้งหมดใน turn นี้ + ผลลัพธ์
  const idToCall = new Map();
  const calls = [];
  for (let i = lastHumanIdx; i < messages.length; i++) {
    const m = messages[i];
    if (m instanceof AIMessage && m.tool_calls?.length) {
      for (const tc of m.tool_calls) idToCall.set(tc.id, { name: tc.name, args: tc.args });
    } else if (m instanceof ToolMessage) {
      const meta = idToCall.get(m.tool_call_id);
      if (meta) {
        const content = typeof m.content === 'string' ? m.content : String(m.content);
        calls.push({ ...meta, result: content.slice(0, 200) });
      }
    }
  }
  const toolSection = calls.length
    ? calls.map((c, i) => `${i + 1}. ${c.name}(${JSON.stringify(c.args)}) → ${c.result}`).join('\n')
    : 'ไม่มี tool ถูกเรียกใน turn นี้';

  // 4. lastCommandedDevice + state ใน KG ปัจจุบัน
  const lcdSection = (() => {
    if (!lastCommandedDevice) return 'ยังไม่เคยมี device ถูกสั่งใน session นี้';
    const current = getDevices(state).find(d => d.topic === lastCommandedDevice.topic);
    const kgState = current ? describeDeviceState(current) : 'ไม่พบใน KG';
    return `${lastCommandedDevice.name} (${lastCommandedDevice.room}) | payload: ${lastCommandedDevice.payload} | KG ตอนนี้: ${kgState}`;
  })();

  const input =
    `[คำสั่ง user (turn นี้)]\n"${userText}"\n\n` +
    `[Tool calls ใน turn นี้]\n${toolSection}\n\n` +
    `[Device ที่ถูกสั่งล่าสุด + state ปัจจุบัน]\n${lcdSection}\n\n` +
    `[Responder text ที่จะส่งให้ user]\n"${responderText}"`;

  const llm = makeLLM(settings, {
    temperature: 0,
    maxTokens: 120,
    structured: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'retry_tool', 'retry_text'] },
        reason:  { type: 'string' },
      },
      required: ['verdict', 'reason'],
    },
  });

  let verdict = 'pass', reason = '';
  try {
    const res = await llm.invoke(
      [new SystemMessage(GUARD_PROMPT), new HumanMessage(input)],
      { signal }
    );
    verdict = res.verdict ?? 'pass';
    reason  = res.reason  ?? '';
    if (!['pass', 'retry_tool', 'retry_text'].includes(verdict)) verdict = 'pass';
  } catch (err) {
    console.warn('[Guard] failed, passing through:', err?.message);
  }

  const update = { guardVerdict: verdict };

  if (verdict === 'retry_tool') {
    update.messages = [new SystemMessage(`[GUARD] ${reason} — กรุณาเรียก tool ให้ถูกต้อง`)];
  } else if (verdict === 'retry_text') {
    update.guardHintForResponder = reason;
    update.responderBuffer = null; // ล้าง buffer เก่า กัน stream ออก
  }

  return update;
}

// ── 7. Executor Node — รัน tool ตาม guard hint ───────────────────────────────

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

// ── 8. Responder Node — stream คำตอบสุดท้ายถึง user ──────────────────────────

async function responderNode(state) {
  const { messages, settings, signal, guardHintForResponder } = state;

  // หา turn ปัจจุบัน + ตัด draft/empty AI msgs ทิ้ง
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

  // ตอน regen (guard บอก retry_text) — inject hint ให้ responder รู้ว่าตอบผิดตรงไหน
  const personaBase = settings.systemPrompt || 'You are a helpful smart home assistant.';
  const personaText = guardHintForResponder
    ? `${personaBase}\n\n[คำเตือนจาก guard] ครั้งก่อนคุณตอบไม่ตรงกับสิ่งที่ระบบทำจริง: ${guardHintForResponder}\nกรุณาตอบใหม่ให้ตรงกับ tool results ที่ได้รับ ห้ามปฏิเสธว่าไม่รู้ถ้า tool คืนข้อมูลมาแล้ว`
    : personaBase;

  const llm = makeLLM(settings, { temperature: 0.3 });

  const fullMessages = [
    new SystemMessage(personaText),
    kgMessage(state),
    ...cleanHistory,
    ...cleanTurnMsgs,
  ];

  // เก็บลง buffer — ยังไม่ส่ง onStream (รอ guard ตรวจ)
  const stream = await llm.stream(fullMessages, { signal });
  const chunks = [];
  let finalMsg;
  for await (const chunk of stream) {
    if (chunk.content) chunks.push(chunk.content);
    finalMsg = finalMsg ? finalMsg.concat(chunk) : chunk;
  }

  return {
    messages: [finalMsg ?? new AIMessage('ขออภัยค่ะ เกิดข้อผิดพลาด')],
    responderBuffer: { chunks, text: chunks.join('') },
    guardHintForResponder: null, // ล้าง hint หลังใช้แล้ว
  };
}

// ── 8.5 Stream Node — replay buffer ให้ user หลัง guard pass ─────────────────

async function streamNode(state) {
  const { responderBuffer, onStream, signal } = state;
  if (!onStream || !responderBuffer?.chunks?.length) return {};

  for (const chunk of responderBuffer.chunks) {
    if (signal?.aborted) return {};
    onStream(chunk);
    // delay เล็กน้อยให้รู้สึกเหมือน stream ปกติ
    await new Promise(r => setTimeout(r, 15));
  }
  return {};
}

// ── 9. Graph Routing ─────────────────────────────────────────────────────────
// router → agent → tools/reflect (loop, max 3) → responder (buffered) → guard → stream/retry
// guard ตรวจ "ข้อความที่ user จะเห็น" ตรง ๆ — ทำงานทุก turn ไม่มีเงื่อนไข
// retry path bounded ด้วย guardRetryCount (max 2) กัน infinite loop

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls?.length > 0) {
    if (state.toolRound >= 3) {
      console.warn("[Agent] Reached max tool rounds. Forcing exit.");
      return "responder";
    }

    // Safety net: ถ้า tool_calls ทุกตัวเหมือนเป๊ะกับที่เคยเรียกใน turn นี้ → บังคับ responder
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

  // ไม่มี tool_calls → ไป responder (guard ย้ายมาหลัง responder)
  return "responder";
}

function routeAfterGuard(state) {
  const v = state.guardVerdict;
  if (v === "retry_tool") return "executor";
  if (v === "retry_text") return "responder";
  return "stream"; // pass หรือ unknown
}

const workflow = new StateGraph(AgentState)
  .addNode("router", routerNode)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("reflect", reflectNode)
  .addNode("responder", responderNode)
  .addNode("guard", guardNode)
  .addNode("executor", executorNode)
  .addNode("stream", streamNode)
  .addEdge(START, "router")
  .addEdge("router", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addConditionalEdges("tools", state => (state.postExecutor || state.reflectDone) ? "responder" : "reflect")
  .addConditionalEdges("reflect", state => state.reflectDone ? "responder" : "agent")
  // responder → guard ครั้งแรกเท่านั้น (guardVerdict===null)
  // ถ้าเคยผ่าน guard แล้ว (regen หลัง retry_text/retry_tool) → stream ตรง ไม่เช็คซ้ำ
  .addConditionalEdges("responder", state => state.guardVerdict ? "stream" : "guard")
  .addConditionalEdges("guard", routeAfterGuard)
  .addConditionalEdges("executor", state => {
    const last = state.messages[state.messages.length - 1];
    return last?.tool_calls?.length > 0 ? "tools" : "responder";
  })
  .addEdge("stream", END);

const compiledGraph = workflow.compile();

// ── 10. Public API ───────────────────────────────────────────────────────────

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
    lastCommandedDevice: params.lastCommandedDevice ?? null,
    pendingTasks: '',
    reflectDone: false,
    guardVerdict: null,
    guardHintForResponder: null,
    responderBuffer: null,
  });

  const lastMsg = finalState.messages[finalState.messages.length - 1];

  let finalReply = lastMsg.content;
  if (!finalReply && lastMsg.tool_calls?.length > 0) {
    finalReply = "ขออภัยค่ะ ระบบพยายามดำเนินการหลายครั้งแต่ไม่สำเร็จ ลองสั่งใหม่อีกครั้งนะคะ 🥺";
  }

  return { reply: finalReply, lastCommandedDevice: finalState.lastCommandedDevice ?? null };
};

// ── 11. Sub-Agents ───────────────────────────────────────────────────────────

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
