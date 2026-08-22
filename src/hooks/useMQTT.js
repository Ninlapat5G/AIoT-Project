import { useState, useEffect, useRef, useCallback } from 'react'
import mqtt from 'mqtt'
import { normalizeBase, buildFullTopic } from '../utils/mqttTopic'

export function useMQTT({ broker, port, baseTopic, onMessage }) {
  const [client, setClient] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [sensorCache, setSensorCache] = useState({})

  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  // one-shot listeners: fullTopic → Set<resolve({ value, packet })>
  const listenersRef = useRef(new Map())
  // reply handlers: corrId → { chunks, resolve, idleTimeoutMs, timer }
  const replyHandlersRef = useRef(new Map())
  // baseTopic ref so the message handler closure always sees the latest value
  const baseTopicRef = useRef(baseTopic)
  useEffect(() => { baseTopicRef.current = baseTopic }, [baseTopic])

  useEffect(() => {
    if (!broker) { setStatus('offline'); return }

    setStatus('connecting')
    let c

    try {
      const connectOptions = {
        clientId: 'synapta_web_' + Math.random().toString(16).substring(2, 10),
        keepalive: 30,
        clean: true,
        reconnectPeriod: 5000,
        protocolVersion: 5,
      }

      const brokerHasPort = /:\d+/.test(broker.replace(/^[a-z]+:\/\//, ''))
      if (port && !brokerHasPort) {
        const parsedPort = parseInt(port, 10)
        if (!isNaN(parsedPort)) connectOptions.port = parsedPort
      }

      c = mqtt.connect(broker, connectOptions)

      c.on('connect', () => {
        setStatus('connected')
        setClient(c)
        const base = normalizeBase(baseTopic)
        c.subscribe(base ? `${base}/#` : '#', { qos: 1 })
      })
      c.on('reconnect', () => setStatus('reconnecting'))
      c.on('error', err => { console.error('MQTT error:', err); setStatus('error') })
      c.on('offline', () => setStatus('offline'))
      c.on('close', () => { setStatus('offline'); setClient(null) })

      c.on('message', (topic, message, packet) => {
        const val = message.toString()
        setSensorCache(prev => prev[topic] === val ? prev : { ...prev, [topic]: val })
        onMessageRef.current?.(topic, val, packet)

        // one-shot listeners
        const resolvers = listenersRef.current.get(topic)
        if (resolvers?.size) {
          resolvers.forEach(resolve => resolve({ value: val, packet }))
          listenersRef.current.delete(topic)
        }

        // reply handlers — topic pattern: {base}/_reply/{corrId}
        const base = normalizeBase(baseTopicRef.current)
        const replyPrefix = base ? `${base}/_reply/` : '_reply/'
        if (topic.startsWith(replyPrefix)) {
          const corrId = topic.slice(replyPrefix.length)
          const handler = replyHandlersRef.current.get(corrId)
          if (!handler) return

          const userProps = packet?.properties?.userProperties
          // userProperties may be object or array of [key,value] pairs
          const streamStatus = Array.isArray(userProps)
            ? userProps.find(([k]) => k === 'stream_status')?.[1]
            : userProps?.stream_status

          if (streamStatus === 'chunk' || streamStatus === 'ping') {
            // ping = heartbeat: รีเซ็ตตัวจับเวลาเฉย ๆ ไม่เก็บเป็นผลลัพธ์
            if (streamStatus === 'chunk' && val) handler.chunks.push(val)
            clearTimeout(handler.timer)
            handler.timer = setTimeout(() => {
              c.unsubscribe(topic)
              replyHandlersRef.current.delete(corrId)
              handler.resolve({ chunks: handler.chunks, timedOut: true })
            }, handler.idleTimeoutMs)
          } else {
            // stream_status='end' → จบ stream
            if (val) handler.chunks.push(val)
            clearTimeout(handler.timer)
            c.unsubscribe(topic)
            replyHandlersRef.current.delete(corrId)
            handler.resolve({ chunks: handler.chunks, timedOut: false })
          }
        }
      })
    } catch (err) {
      console.error('MQTT init error:', err)
      setStatus('error')
    }

    return () => {
      if (c) { c.end(); setClient(null); setStatus('offline') }
    }
  }, [broker, port, baseTopic])

  // Send a command and collect a streaming reply on a unique reply topic.
  // Resolves to { chunks: string[], timedOut: boolean }
  const requestResponse = useCallback((relCmdTopic, payload, opts = {}) => {
    const { idleTimeoutMs = 60000, messageExpiryInterval = 30 } = opts

    if (!client) return Promise.resolve({ chunks: [], timedOut: false, noClient: true })

    const corrId = crypto.randomUUID()
    const base = normalizeBase(baseTopic)
    const replyTopic = buildFullTopic(`_reply/${corrId}`, base)
    const fullCmdTopic = buildFullTopic(relCmdTopic, base)

    return new Promise(resolve => {
      client.subscribe(replyTopic, { qos: 1 })

      const handler = {
        chunks: [],
        resolve,
        idleTimeoutMs,
        timer: setTimeout(() => {
          client.unsubscribe(replyTopic)
          replyHandlersRef.current.delete(corrId)
          resolve({ chunks: handler.chunks, timedOut: true })
        }, idleTimeoutMs),
      }

      replyHandlersRef.current.set(corrId, handler)

      client.publish(fullCmdTopic, String(payload), {
        qos: 1,
        properties: {
          responseTopic: replyTopic,
          correlationData: new TextEncoder().encode(corrId),
          messageExpiryInterval,
        },
      })
    })
  }, [client, baseTopic])

  // Wait for a single message on fullTopic.
  // Resolves to { value, packet } when received, or null on timeout.
  const waitForMessage = useCallback((fullTopic, timeoutMs = 10000) => {
    return new Promise(resolve => {
      const set = listenersRef.current.get(fullTopic) ?? new Set()

      // เคลียร์ timeout timer ทันทีที่ข้อความมาถึงก่อนหมดเวลา — ไม่งั้น timer
      // จะยังทำงานค้างอยู่จนครบ timeoutMs เปล่าๆ (สูงสุด 300s ในเส้นทาง PIN share)
      const handler = result => { clearTimeout(timer); resolve(result) }
      const timer = setTimeout(() => {
        const s = listenersRef.current.get(fullTopic)
        if (s) { s.delete(handler); if (!s.size) listenersRef.current.delete(fullTopic) }
        resolve(null)
      }, timeoutMs)

      set.add(handler)
      listenersRef.current.set(fullTopic, set)
    })
  }, [])

  const publish = useCallback((topic, payload, opts = {}) => {
    if (!client) return null
    const base = normalizeBase(baseTopic)
    const fullTopic = buildFullTopic(topic, base)
    client.publish(fullTopic, String(payload), { qos: 1, ...opts })
    return fullTopic
  }, [client, baseTopic])

  return { client, status, sensorCache, publish, waitForMessage, requestResponse }
}
