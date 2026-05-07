// ── Skill Tool Handlers ────────────────────────────────────────────────────────
// Each handler: async (args, ctx) => result
// ctx = { mqttClient, settings, mqttWaitForStream,
//          devicesRef, baseTopicRef, setDevices,
//          normalizeBase, buildFullTopic }
//
// To add a new skill:
//   1. Add a handler function below
//   2. Register it in toolHandlers map
//   3. Add its definition to DEFAULT_SETTINGS.skills in data.js

import { generateSearchQuery } from './agent.js'

// ── Knowledge Graph Tool ───────────────────────────────────────────────────────

async function queryKnowledgeGraph(args, ctx) {
  const { settings, devicesRef } = ctx
  const { action } = args

  if (action !== 'get_context') return { success: false, error: `Unknown action: ${action}` }

  const enabledSkillIds = new Set(
    (settings.skills || []).filter(s => s.enabled).map(s => s.name)
  )

  const activeDevices = (devicesRef.current || [])
    .filter(d => d.type !== 'os_terminal')
    .filter(d => {
      if (d.type === 'hub') return enabledSkillIds.has('hub')
      return enabledSkillIds.has('mqtt_publish') || enabledSkillIds.has('mqtt_read')
    })
    .map(d => ({
      name: d.name,
      room: d.room,
      type: d.type,
      state: d.type === 'digital' ? (d.on ? 'ON' : 'OFF')
           : d.type === 'analog'  ? `${d.value}/${d.max ?? 255}`
           : null,
      pubTopic: d.pubTopic,
      subTopic: d.subTopic ?? null,
      tool: d.type === 'hub' ? 'hub' : 'mqtt_publish / mqtt_read',
    }))

  return {
    success: true,
    timestamp: new Date().toLocaleString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }),
    user_profile: {
      name: settings.profile?.displayName || settings.profile?.userBio || 'User',
      bio: settings.profile?.userBio || '',
    },
    active_devices: activeDevices,
    enabled_skills: [...enabledSkillIds],
    total: activeDevices.length,
  }
}
import { runSettingsAgent } from './settingsAgent.js'

const SERPER_URL = 'https://google.serper.dev/search'

async function mqttPublish(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, setDevices, normalizeBase, buildFullTopic } = ctx

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const { topic, payload } = args

  // hub devices have a dedicated tool — block direct publish.
  const hubMatch = devicesRef.current.find(
    d => d.type === 'hub' &&
      (d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic))
  )
  if (hubMatch) {
    return {
      success: false,
      error: `"${hubMatch.name}" is a hub device — use the hub tool instead of mqtt_publish`,
    }
  }

  const device = devicesRef.current.find(
    d => d.type !== 'hub' &&
      (d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic))
  )

  let finalTopic = topic;
  let isRaw = false;

  if (!device) {
    isRaw = true;
  } else {
    finalTopic = device.pubTopic;
  }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(finalTopic, base)

  return new Promise(resolve => {
    mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
      if (err) { resolve({ success: false, error: err.message }); return }

      if (device) {
        setDevices(prev => prev.map(d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' || payload === 'ON' || payload === '1' }
          if (d.type === 'analog') return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }))
      }

      resolve({
        success: true,
        topic: fullTopic,
        payload,
        message: isRaw ? 'Published to unlisted raw topic.' : 'Published.'
      })
    })
  })
}

async function mqttRead(args, ctx) {
  const { devicesRef } = ctx

  const topic = typeof args === 'string' ? args.trim() : args?.topic
  if (!topic) return { success: false, error: 'No topic specified' }

  // hub devices are not readable via mqtt_read
  const device = devicesRef.current.find(
    d => d.type !== 'hub' && (
      d.pubTopic === topic || d.subTopic === topic ||
      d.pubTopic?.endsWith('/' + topic) || d.subTopic?.endsWith('/' + topic)
    )
  )

  if (!device) return { success: false, error: `No device found for topic: ${topic}` }

  const value = device.type === 'digital' ? (device.on ? 'ON' : 'OFF') : String(device.value)
  return { success: true, device: device.name, room: device.room, value }
}

async function hubCommand(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef,
    mqttWaitForStream, normalizeBase, buildFullTopic, signal } = ctx

  // เปลี่ยนมารับ topic แทน
  const { task, topic } = args
  if (!mqttClient) return { success: false, error: 'MQTT not connected' }
  if (!task || !topic) return { success: false, error: 'Missing args: task, topic' }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(topic, base)
  const device = devicesRef.current.find(
    d => d.type === 'hub' && (d.pubTopic === topic || buildFullTopic(d.pubTopic, base) === fullTopic)
  )
  if (!device) return { success: false, error: `Hub device with topic '${topic}' not found in device list` }
  if (!device.pubTopic) return { success: false, error: `Hub device '${device.name}' has no pubTopic` }

  const outputTopic = device.subTopic
    ? buildFullTopic(device.subTopic, base)
    : null

  const cancelTopic = buildFullTopic(device.pubTopic.replace(/\/cmd$/, '/cancel'), base)
  signal?.addEventListener('abort', () => {
    mqttClient.publish(cancelTopic, 'cancel', { qos: 1 })
  }, { once: true })

  const streamPromise = outputTopic ? mqttWaitForStream(outputTopic, 60000) : null

  try {
    await new Promise((resolve, reject) =>
      mqttClient.publish(fullTopic, task, { qos: 2 }, err => err ? reject(err) : resolve())
    )
  } catch (err) {
    return { success: false, error: err.message }
  }

  if (!streamPromise) return { success: true, summary: `Task sent to ${device.name}: ${task}` }

  const { chunks, timedOut } = await streamPromise
  const output = chunks.join('\n')

  if (timedOut && chunks.length === 0)
    return { success: true, summary: `Task sent to ${device.name}\n\n⚠️ ไม่ได้รับผลลัพธ์ — hub agent อาจออฟไลน์อยู่` }

  const note = timedOut ? '\n\n⚠️ ไม่ได้รับ (mqtt_end) — hub agent อาจขาดการเชื่อมต่อ' : ''
  return { success: true, summary: `${output || '(no output)'}${note}` }
}

async function webSearch(args, ctx) {
  const { settings } = ctx
  const { query } = args

  if (!query) return { success: false, error: 'No search query provided' }

  const apiKey = settings.serperApiKey
  if (!apiKey) return { success: false, error: 'Serper API key ยังไม่ได้ตั้งค่า — ไปที่ Settings → Integrations' }

  let optimizedQuery = query
  try {
    optimizedQuery = await generateSearchQuery({ settings, query })
  } catch { /* ใช้ query เดิมถ้า optimize ไม่ได้ */ }

  let res
  try {
    res = await fetch(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: optimizedQuery, num: 3 }),
    })
  } catch (err) {
    return { success: false, error: `Network error: ${err.message}` }
  }

  if (res.status === 403) return { success: false, error: 'Serper API key ไม่ถูกต้อง หรือ quota หมดแล้ว — ตรวจสอบที่ serper.dev/dashboard' }
  if (res.status === 429) return { success: false, error: 'Serper API rate limit exceeded — ลองใหม่อีกสักครู่' }
  if (!res.ok) return { success: false, error: `Serper API error: HTTP ${res.status}` }

  const data = await res.json()

  const parts = []

  if (data.answerBox?.answer)
    parts.push(data.answerBox.answer)
  else if (data.answerBox?.snippet)
    parts.push(data.answerBox.snippet)

  if (data.knowledgeGraph?.description)
    parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)

  const organic = (data.organic || []).slice(0, 3)
  if (organic.length)
    parts.push(organic.map(r => `${r.title}\n${r.snippet}\n${r.link}`).join('\n\n'))

  const summary = parts.join('\n\n') || 'No results found'
  return { success: true, query: optimizedQuery, summary }
}

async function manageSettings(args, ctx) {
  const { settings, handleSaveSettings, devicesRef, signal } = ctx
  const { query } = args
  if (!query) return { success: false, error: 'No query provided' }

  const response = await runSettingsAgent({
    query,
    settings,
    devicesRef,
    onSettingsChange: handleSaveSettings,
    signal,
  })
  return { success: true, response }
}

// ── Registry ───────────────────────────────────────────────────────────────────

const toolHandlers = {
  query_knowledge_graph: queryKnowledgeGraph,
  mqtt_publish:          mqttPublish,
  mqtt_read:             mqttRead,
  hub:                   hubCommand,
  web_search:            webSearch,
  manage_settings:       manageSettings,
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createExecuteTool(ctx) {
  return async function executeTool(name, args, signal) {
    const skill = (ctx.settings.skills || []).find(sk => sk.name === name)
    if (skill && !skill.enabled) return { success: false, error: `Tool "${name}" is disabled` }
    const handler = toolHandlers[name]
    if (!handler) return { success: false, error: `Unknown tool: ${name}` }
    return handler(args, { ...ctx, signal })
  }
}
