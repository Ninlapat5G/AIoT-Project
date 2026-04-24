// ── Skill Tool Handlers ────────────────────────────────────────────────────────
// Each handler: async (args, ctx) => result
// ctx = { mqttClient, sensorCache, settings, mqttWaitForMessage,
//          devicesRef, baseTopicRef, setDevices,
//          normalizeBase, buildFullTopic, generateOsCommand }
//
// To add a new skill:
//   1. Add a handler function below
//   2. Register it in toolHandlers map
//   3. Add its definition to DEFAULT_SETTINGS.skills in data.js

async function mqttPublish(args, ctx) {
  const { mqttClient, devicesRef, baseTopicRef, setDevices, normalizeBase, buildFullTopic } = ctx

  if (!mqttClient) return { success: false, error: 'MQTT not connected' }

  const { topic, payload } = args
  const device = devicesRef.current.find(
    d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic)
  )
  const rawTopic = device ? device.pubTopic : topic
  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(rawTopic, base)

  return new Promise(resolve => {
    mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
      if (err) { resolve({ success: false, error: err.message }); return }
      if (device) {
        setDevices(prev => prev.map(d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' }
          if (d.type === 'analog')  return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }))
      }
      resolve({ success: true, topic: fullTopic, payload, message: 'Published.' })
    })
  })
}

async function mqttRead(args, ctx) {
  const { sensorCache, baseTopicRef, normalizeBase, buildFullTopic } = ctx

  const topic = typeof args === 'string' ? args.trim() : args?.topic
  if (!topic) return { success: false, error: 'No topic specified' }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(topic, base)
  const val = sensorCache[fullTopic]

  if (val !== undefined) return { success: true, topic: fullTopic, value: val }
  return { success: false, note: `No data cached for topic: ${fullTopic}` }
}

async function osCommand(args, ctx) {
  const { mqttClient, settings, devicesRef, baseTopicRef,
          mqttWaitForMessage, normalizeBase, buildFullTopic, generateOsCommand } = ctx

  const { instruction, os, topic, wait_output } = args
  if (!mqttClient)                      return { success: false, error: 'MQTT not connected' }
  if (!instruction || !os || !topic)    return { success: false, error: 'Missing args: instruction, os, topic' }

  let command
  try {
    command = await generateOsCommand({ settings, instruction, os })
  } catch (err) {
    return { success: false, error: err.message }
  }

  const base = normalizeBase(baseTopicRef.current)
  const fullTopic = buildFullTopic(topic, base)
  const device = devicesRef.current.find(
    d => d.pubTopic === topic || buildFullTopic(d.pubTopic, base) === fullTopic
  )
  const outputTopic = wait_output && device?.subTopic
    ? buildFullTopic(device.subTopic, base)
    : null

  try {
    await new Promise((resolve, reject) =>
      mqttClient.publish(fullTopic, command, { qos: 2 }, err => err ? reject(err) : resolve())
    )
  } catch (err) {
    return { success: false, error: err.message }
  }

  const output = outputTopic ? await mqttWaitForMessage(outputTopic, 10000) : null
  return { success: true, topic: fullTopic, command, os, ...(output != null && { output }) }
}

// ── Registry ───────────────────────────────────────────────────────────────────

const toolHandlers = {
  mqtt_publish: mqttPublish,
  mqtt_read:    mqttRead,
  os_command:   osCommand,
}

// ── Factory ────────────────────────────────────────────────────────────────────
// Usage: const executeTool = createExecuteTool(ctx)
// ctx is built once in App.jsx and passed here — no re-creation unless deps change

export function createExecuteTool(ctx) {
  return async function executeTool(name, args) {
    const handler = toolHandlers[name]
    if (!handler) return { success: false, error: `Unknown tool: ${name}` }
    return handler(args, ctx)
  }
}
