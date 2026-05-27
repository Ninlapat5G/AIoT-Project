import mqtt from 'mqtt'
import { normalizeBase, buildFullTopic } from './mqttTopic'

// จำลอง ESP32 SynaptaNode ใน browser — ใช้สำหรับทดสอบ MQTT 5 flow
// ไม่แชร์ client กับ Web App หลัก — ใช้ connection แยกต่างหาก

export function createSimulator({ broker, port, baseTopic, name, topic, type, onLog, onStatusChange }) {
  const base = normalizeBase(baseTopic)
  const nodeId = `sim-${topic.replace(/[^a-z0-9]/gi, '')}-${Math.random().toString(36).slice(2, 6)}`
  const statusTopic  = buildFullTopic(`nodes/${nodeId}/status`, base)
  const manifestTopic = buildFullTopic(`nodes/${nodeId}/manifest`, base)
  const cmdTopic     = buildFullTopic(`${topic}/set`, base)
  const configTopic  = buildFullTopic(`${topic}/config`, base)
  const stateTopic   = buildFullTopic(`${topic}/state`, base)

  let client = null
  let state = type === 'digital' ? false : 0

  function log(msg) { onLog?.(`[${new Date().toLocaleTimeString()}] ${msg}`) }

  function publishState() {
    if (!client?.connected) return
    const payload = type === 'digital' ? String(state) : String(state)
    client.publish(stateTopic, payload, {
      qos: 1, retain: true,
      properties: {
        messageExpiryInterval: 300,
        userProperties: { device_id: nodeId, fw: '1.0.0-sim' },
      },
    })
    log(`state published: ${payload}`)
  }

  function publishManifest() {
    if (!client?.connected) return
    const manifest = JSON.stringify({
      nodeId,
      baseTopic: base || '',
      fw: '1.0.0-sim',
      devices: [{
        topic,
        type,
        configured: true,
        stateTopic,
        cmdTopic,
        configTopic,
      }],
    })
    client.publish(manifestTopic, manifest, {
      qos: 1, retain: true,
      properties: { messageExpiryInterval: 3600 },
    })
    log(`announced: ${name} (${topic})`)
  }

  function handleCmd(payload) {
    if (type === 'digital') {
      state = payload === 'true' || payload === 'on' || payload === 'ON' || payload === '1'
    } else {
      state = Math.max(0, Math.min(255, parseInt(payload, 10) || 0))
    }
    log(`received cmd: ${payload}`)
    publishState()
  }

  function handleConfig(payload, packet) {
    log(`config received: ${payload}`)
    const responseTopic = packet?.properties?.responseTopic
    const corrData = packet?.properties?.correlationData

    if (responseTopic && client?.connected) {
      let pin = null
      try {
        const cfg = JSON.parse(payload)
        pin = cfg.pin
      } catch { /* ignore */ }

      const ack = JSON.stringify({ ok: true, applied: pin != null ? { pin } : {} })
      client.publish(responseTopic, ack, {
        qos: 1,
        properties: corrData
          ? { correlationData: corrData, userProperties: { stream_status: 'end' } }
          : { userProperties: { stream_status: 'end' } },
      })
      log(`ACK sent: ${ack}`)
    }
  }

  return {
    connect() {
      if (client) return

      const connectOptions = {
        clientId: nodeId,
        protocolVersion: 5,
        keepalive: 30,
        clean: true,
        will: {
          topic: statusTopic,
          payload: 'offline',
          qos: 1,
          retain: true,
          properties: {
            userProperties: { device_id: nodeId, reason: 'power_loss' },
          },
        },
      }
      if (port) {
        const p = parseInt(port, 10)
        if (!isNaN(p)) connectOptions.port = p
      }

      client = mqtt.connect(broker, connectOptions)
      onStatusChange?.('connecting')

      client.on('connect', () => {
        onStatusChange?.('online')
        client.publish(statusTopic, 'online', { qos: 1, retain: true })
        client.subscribe([cmdTopic, configTopic], { qos: 1 })
        publishManifest()
        publishState()
      })

      client.on('message', (t, msg, packet) => {
        const payload = msg.toString()
        if (t === cmdTopic) handleCmd(payload)
        else if (t === configTopic) handleConfig(payload, packet)
      })

      client.on('offline', () => onStatusChange?.('offline'))
      client.on('error', err => { log(`error: ${err.message}`); onStatusChange?.('error') })
      client.on('close', () => onStatusChange?.('offline'))
    },

    disconnect() {
      if (!client) return
      client.publish(statusTopic, 'offline', { qos: 1, retain: true })
      client.end()
      client = null
      onStatusChange?.('offline')
      log('disconnected gracefully')
    },

    // จำลองไฟดับ — ทำลาย TCP โดยไม่ส่ง DISCONNECT → broker ส่ง Will
    powerLoss() {
      if (!client) return
      const stream = client.stream
      client.end(true)       // force close
      stream?.destroy?.()    // destroy underlying socket ถ้าทำได้
      client = null
      onStatusChange?.('offline')
      log('power loss simulated — broker will send Will Message')
    },

    isConnected: () => !!client?.connected,
  }
}
