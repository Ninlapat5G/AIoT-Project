import { useState, useEffect, useRef, useCallback } from 'react'
import mqtt from 'mqtt'
import { normalizeBase, buildFullTopic } from '../utils/mqttTopic'

export function useMQTT({ broker, port, baseTopic, onMessage }) {
  const [client, setClient] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [sensorCache, setSensorCache] = useState({})

  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  // one-shot listeners: fullTopic → Set<resolve>
  const listenersRef = useRef(new Map())
  // stream listeners: fullTopic → { chunks, resolve, timer, idleTimeoutMs }
  const streamHandlersRef = useRef(new Map())

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
      }

      if (port) {
        const parsedPort = parseInt(port, 10)
        if (!isNaN(parsedPort)) {
          connectOptions.port = parsedPort
        }
      }

      c = mqtt.connect(broker, connectOptions)

      c.on('connect', () => {
        setStatus('connected')
        setClient(c)
        const base = normalizeBase(baseTopic)
        c.subscribe(base ? `${base}/#` : '#', { qos: 2 })
      })
      c.on('reconnect', () => setStatus('reconnecting'))
      c.on('error', (err) => {
        console.error('MQTT Connection Error:', err)
        setStatus('error')
      })
      c.on('offline', () => setStatus('offline'))
      c.on('close', () => { setStatus('offline'); setClient(null) })

      c.on('message', (topic, message) => {
        const val = message.toString()
        setSensorCache(prev => prev[topic] === val ? prev : { ...prev, [topic]: val })
        onMessageRef.current?.(topic, val)

        const resolvers = listenersRef.current.get(topic)
        if (resolvers?.size) {
          resolvers.forEach(resolve => resolve(val))
          listenersRef.current.delete(topic)
        }

        const sh = streamHandlersRef.current.get(topic)
        if (sh) {
          if (val === '(mqtt_end)') {
            clearTimeout(sh.timer)
            clearTimeout(sh.ackTimer)
            streamHandlersRef.current.delete(topic)
            sh.resolve({ chunks: sh.chunks, timedOut: false })
          } else if (!sh.ackReceived) {
            if (val === sh.ackMsg) {
              sh.ackReceived = true
              clearTimeout(sh.ackTimer)
              sh.timer = setTimeout(() => {
                streamHandlersRef.current.delete(topic)
                sh.resolve({ chunks: sh.chunks, timedOut: true })
              }, sh.idleTimeoutMs)
            }
            // message ที่ไม่ใช่ ack ก่อนได้รับ ack — ไม่รับ (ผิด protocol)
          } else {
            sh.chunks.push(val)
            clearTimeout(sh.timer)
            sh.timer = setTimeout(() => {
              streamHandlersRef.current.delete(topic)
              sh.resolve({ chunks: sh.chunks, timedOut: true })
            }, sh.idleTimeoutMs)
          }
        }
      })
    } catch (err) {
      console.error('MQTT Initialization Error:', err)
      setStatus('error')
    }

    return () => {
      if (c) { c.end(); setClient(null); setStatus('offline') }
    }
  }, [broker, port, baseTopic])

  const waitForStream = useCallback((fullTopic, idleTimeoutMs = 10000, opts = {}) => {
    const { ackMsg, ackTimeoutMs = 5000 } = opts
    return new Promise(resolve => {
      const handler = {
        chunks: [],
        idleTimeoutMs,
        resolve,
        timer: null,
        ackMsg:     ackMsg || null,
        ackReceived: !ackMsg,
        ackTimer: ackMsg
          ? setTimeout(() => {
              streamHandlersRef.current.delete(fullTopic)
              resolve({ chunks: [], timedOut: false, ackTimedOut: true })
            }, ackTimeoutMs)
          : null,
      }
      if (!ackMsg) {
        handler.timer = setTimeout(() => {
          streamHandlersRef.current.delete(fullTopic)
          resolve({ chunks: [], timedOut: true })
        }, idleTimeoutMs)
      }
      streamHandlersRef.current.set(fullTopic, handler)
    })
  }, [])

  const waitForMessage = useCallback((fullTopic, timeoutMs = 10000) => {
    return new Promise(resolve => {
      const set = listenersRef.current.get(fullTopic) ?? new Set()
      set.add(resolve)
      listenersRef.current.set(fullTopic, set)
      setTimeout(() => {
        const s = listenersRef.current.get(fullTopic)
        if (s) { s.delete(resolve); if (!s.size) listenersRef.current.delete(fullTopic) }
        resolve(null)
      }, timeoutMs)
    })
  }, [])

  const publish = useCallback((topic, payload, opts = {}) => {
    if (!client) return null
    const base = normalizeBase(baseTopic)
    const fullTopic = buildFullTopic(topic, base)
    client.publish(fullTopic, String(payload), { qos: 2, ...opts })
    return fullTopic
  }, [client, baseTopic])

  return { client, status, sensorCache, publish, waitForMessage, waitForStream }
}