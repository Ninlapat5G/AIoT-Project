/**
 * Settings Agent
 *
 * Agent ที่รู้จัก tools/skills ทั้งหมดของระบบ — อธิบายได้และจัดการได้
 *
 * Dynamic design: system prompt สร้างจาก settings.skills ณ ตอนเรียก
 *   → เมื่อเพิ่ม skill ใหม่ใน data.js มันปรากฏในที่นี้อัตโนมัติ
 *   → ถ้า skill ใหม่มี requirement พิเศษ เพิ่มแค่ใน SKILL_REQUIREMENTS
 *
 * Tools ที่ agent ใช้ได้:
 *   - read_settings : อ่านสถานะทั้งหมด (ไม่เปิดเผยค่าจริงของ key)
 *   - toggle_skill  : เปิด/ปิด skill
 *
 * READ-ONLY (ห้ามแก้): apiKey, serperApiKey, endpoint, MQTT broker/port
 */

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { DEFAULT_API_KEY } from '../config/default_key'

// ── Skill Requirements Registry ───────────────────────────────────────────────
// เพิ่ม entry ตรงนี้เมื่อเพิ่ม skill ที่มี requirement พิเศษ
// skill ที่ไม่มีในนี้ = ไม่มี requirement พิเศษ

const SKILL_REQUIREMENTS = {
  web_search:   { needs: 'Serper API key', settingKey: 'serperApiKey', link: 'https://serper.dev/api-keys' },
  hub:          { needs: 'hub device ในรายการอุปกรณ์ + MQTT connection' },
  mqtt_publish: { needs: 'MQTT connection' },
  mqtt_read:    { needs: 'MQTT connection' },
}

// ── Dynamic System Prompt ─────────────────────────────────────────────────────

function buildSystemPrompt(settings) {
  const skillLines = (settings.skills || []).map(sk => {
    const req = SKILL_REQUIREMENTS[sk.name]
    let reqStr = 'ไม่มี requirement พิเศษ'
    if (req) {
      const keyStatus = req.settingKey
        ? ` — ${settings[req.settingKey] ? 'ตั้งค่าแล้ว ✓' : `ยังไม่ได้ตั้งค่า ✗ (${req.link})`}`
        : ''
      reqStr = `ต้องการ: ${req.needs}${keyStatus}`
    }
    return `  • ${sk.name} [${sk.enabled ? 'เปิด' : 'ปิด'}]\n    ${sk.description}\n    ${reqStr}`
  }).join('\n\n')

  return `คุณคือ Settings Agent ของระบบ SynaptaOS
ตอบภาษาไทย กระชับ ตรงประเด็น ไม่ต้องทักทาย

[SKILLS ทั้งหมดในระบบ — สร้างจากข้อมูลปัจจุบัน]
${skillLines}

[สิ่งที่ทำได้]
- อธิบายว่า skill แต่ละตัวทำอะไร ต้องการอะไร และสถานะปัจจุบัน
- เรียก read_settings เพื่ออ่านสถานะ settings ปัจจุบัน
- เรียก toggle_skill เพื่อเปิด/ปิด skill ตามที่ถูกขอ

[READ-ONLY — ห้ามแก้ไข ให้แนะนำ user ไปที่ Settings page แทน]
API key (Typhoon), Serper API key, Endpoint, MQTT broker, MQTT port`
}

// ── Agent Tools ───────────────────────────────────────────────────────────────

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_settings',
      description: 'อ่านสถานะการตั้งค่าและ skills ทั้งหมดในปัจจุบัน',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_skill',
      description: 'เปิดหรือปิด skill',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'ชื่อ skill เช่น web_search, hub, mqtt_publish' },
          enabled:    { type: 'boolean', description: 'true = เปิด | false = ปิด' },
        },
        required: ['skill_name', 'enabled'],
      },
    },
  },
]

// ── Tool Executors ────────────────────────────────────────────────────────────

function execReadSettings(settings) {
  return {
    skills: (settings.skills || []).map(sk => ({
      name: sk.name,
      enabled: sk.enabled,
    })),
    apiKey:      settings.apiKey      ? 'set' : 'not set',
    serperKey:   settings.serperApiKey? 'set' : 'not set',
    endpoint:    settings.endpoint,
    model:       settings.model,
    mqttBroker:  settings.mqtt?.broker,
    mqttPort:    settings.mqtt?.port,
    userName:    settings.profile?.userBio || 'not set',
  }
}

function execToggleSkill({ skill_name, enabled }, settings, onSettingsChange) {
  const skill = (settings.skills || []).find(sk => sk.name === skill_name)
  if (!skill) return { success: false, error: `ไม่พบ skill "${skill_name}"` }

  const updatedSkills = settings.skills.map(sk =>
    sk.name === skill_name ? { ...sk, enabled } : sk
  )
  onSettingsChange({ ...settings, skills: updatedSkills })
  return { success: true, skill_name, enabled }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runSettingsAgent({ query, settings, onSettingsChange, signal }) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.1,
  })

  const allMsgs = [
    new SystemMessage(buildSystemPrompt(settings)),
    new HumanMessage(query),
  ]

  // Pass 1 — may call tools
  const resp1 = await llm.bindTools(AGENT_TOOLS).invoke(allMsgs, { signal })

  if (!resp1.tool_calls?.length) return resp1.content || ''

  // Execute tools
  const toolMsgs = resp1.tool_calls.map(tc => {
    let result
    if (tc.name === 'read_settings') {
      result = execReadSettings(settings)
    } else if (tc.name === 'toggle_skill') {
      result = execToggleSkill(tc.args, settings, onSettingsChange)
    } else {
      result = { error: `Unknown tool: ${tc.name}` }
    }
    return new ToolMessage({ content: JSON.stringify(result), name: tc.name, tool_call_id: tc.id })
  })

  // Pass 2 — final answer with tool results
  const resp2 = await llm.invoke([...allMsgs, resp1, ...toolMsgs], { signal })
  return resp2.content || ''
}
