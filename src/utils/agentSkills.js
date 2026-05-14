// ── Skill Tool Handlers ────────────────────────────────────────────────────────
// Each handler: async (args, ctx) => result
// ctx = { mqttClient, settings, mqttWaitForStream,
//          devicesRef, baseTopicRef, setDevices, handleSaveSettings }
//
// To add a new skill:
//   1. Add a handler function below
//   2. Register it in toolHandlers map
//   3. Add its definition to DEFAULT_SETTINGS.skills in data.js

import { generateSearchQuery } from './agent.js'
import { snapshotJson } from './kg.js'
import { runSettingsAgent } from './settingsAgent.js'
import { normalizeBase, buildCmdTopic, buildStateTopic } from './mqttTopic.js'

// ── Knowledge Graph Tool ───────────────────────────────────────────────────────
// Delegate ทั้งหมดไปที่ kg.js — single source of truth

async function queryKnowledgeGraph(args, ctx) {
  const { settings, devicesRef } = ctx
  const { action } = args

  if (action !== 'get_context') return { success: false, error: `Unknown action: ${action}` }

  const now = new Date().toLocaleString('th-TH-u-ca-gregory', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', timeZoneName: 'short',
  })

  return {
    success: true,
    ...snapshotJson({ devices: devicesRef.current, settings, now }),
  }
}

const SERPER_URL = 'https://google.serper.dev/search'

// helper: หา device จาก topic ที่ AI ระบุมา (รองรับทั้ง full path และ suffix)
function findDeviceByTopic(devices, topic, type = null) {
  return devices.find(d => {
    if (type && d.type !== type) return false
    if (!d.topic) return false
    return (
      d.topic === topic ||
      d.topic.endsWith('/' + topic) ||          // d.topic ยาวกว่า (มี prefix)
      topic === d.topic + '/set' ||
      topic === d.topic + '/state' ||
      topic.endsWith('/' + d.topic) ||          // topic ยาวกว่า (มี base prefix)
      topic.endsWith('/' + d.topic + '/set') ||
      topic.endsWith('/' + d.topic + '/state')
    )
  })
}

async function mqttPublish(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, setDevices } = ctx

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const { topic, payload } = args
  const base = normalizeBase(baseTopicRef.current)

  // hub devices มี tool เฉพาะ — ไม่ให้ publish ตรง
  const hubMatch = findDeviceByTopic(devicesRef.current, topic, 'hub')
  if (hubMatch) {
    return {
      success: false,
      error: `"${hubMatch.name}" is a hub device — use the hub tool instead of mqtt_publish`,
    }
  }

  const device = findDeviceByTopic(devicesRef.current, topic)
  const fullTopic = device ? buildCmdTopic(device.topic, base) : topic

  return new Promise(resolve => {
    mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
      if (err) { resolve({ success: false, error: err.message }); return }

      if (device) {
        const applyUpdate = d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' || payload === 'ON' || payload === '1' }
          if (d.type === 'analog') return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }
        // อัปเดต ref ทันที — graph nodes ที่รันต่อจากนี้ (reflect/guard) จะเห็น state ใหม่
        devicesRef.current = devicesRef.current.map(applyUpdate)
        // อัปเดต React state ด้วย — เพื่อ sync UI
        setDevices(prev => prev.map(applyUpdate))
      }

      resolve({
        success: true,
        ...(device ? { device: device.name } : { topic: fullTopic }),
        payload,
        message: 'Published.',
      })
    })
  })
}

async function hubCommand(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, mqttWaitForStream, signal } = ctx

  const { task, topic } = args
  if (!mqttClient) return { success: false, error: 'MQTT not connected' }
  if (!task || !topic) return { success: false, error: 'Missing args: task, topic' }

  const base   = normalizeBase(baseTopicRef.current)
  const device = findDeviceByTopic(devicesRef.current, topic, 'hub')
  if (!device)       return { success: false, error: `Hub device with topic '${topic}' not found` }
  if (!device.topic) return { success: false, error: `Hub device '${device.name}' has no topic` }

  // hub ใช้ /cmd และ /output แทน /set และ /state
  const fullTopic   = buildCmdTopic(device.topic, base).replace(/\/set$/, '/cmd')
  const outputTopic = buildStateTopic(device.topic, base).replace(/\/state$/, '/output')
  const cancelTopic = buildCmdTopic(device.topic, base).replace(/\/set$/, '/cancel')

  signal?.addEventListener('abort', () => {
    mqttClient.publish(cancelTopic, 'cancel', { qos: 1 })
  }, { once: true })

  const streamPromise = mqttWaitForStream(outputTopic, 60000, { ackMsg: '(mqtt_start)', ackTimeoutMs: 5000 })

  try {
    await new Promise((resolve, reject) =>
      mqttClient.publish(fullTopic, task, { qos: 2 }, err => err ? reject(err) : resolve())
    )
  } catch (err) {
    return { success: false, error: err.message }
  }

  const { chunks, timedOut, ackTimedOut } = await streamPromise

  if (ackTimedOut)
    return { success: false, error: `ติดต่อ '${device.name}' ไม่ได้ — hub อาจปิดเครื่องอยู่หรือเน็ตหลุด` }

  const output = chunks.join('\n')
  const note = timedOut ? '\n\n⚠️ ไม่ได้รับ (mqtt_end) — hub agent อาจขาดการเชื่อมต่อ' : ''
  return { success: true, summary: `${output || '(no output)'}${note}` }
}

async function webSearch(args, ctx) {
  const { settings } = ctx
  const { query } = args

  if (!query) return { success: false, error: 'No search query provided' }

  const apiKey = settings.serperApiKey
  if (!apiKey) return { success: false, error: 'Serper API key ยังไม่ได้ตั้งค่า — แจ้ง user ทันที ห้ามเรียก web_search อีก' }

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

  if (res.status === 401 || res.status === 403) return { success: false, error: 'Serper API key ไม่ถูกต้องหรือ quota หมด — แจ้ง user ทันที ห้ามลองซ้ำ' }
  if (res.status === 429) return { success: false, error: 'Serper rate limit — แจ้ง user ทันที ห้ามลองซ้ำ' }
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

  try {
    const response = await runSettingsAgent({
      query,
      settings,
      devicesRef,
      onSettingsChange: handleSaveSettings,
      signal,
    })
    return { success: true, response }
  } catch (err) {
    return { success: false, error: `Settings agent error: ${err.message}` }
  }
}

// ── Registry ───────────────────────────────────────────────────────────────────

const toolHandlers = {
  query_knowledge_graph: queryKnowledgeGraph,
  mqtt_publish:          mqttPublish,
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
