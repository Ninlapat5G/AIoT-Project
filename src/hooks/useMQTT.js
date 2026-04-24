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

      // ดึง port จาก Setting มาใช้จริง
      if (port) {
        connectOptions.port = parseInt(port, 10)
      }

      c = mqtt.connect(broker, connectOptions)

      c.on('connect', () => {
        setStatus('connected')
        setClient(c)
        const base = normalizeBase(baseTopic)
        c.subscribe(base ? `${base}/#` : '#', { qos: 2 })
      })
      c.on('reconnect', () => setStatus('reconnecting'))
      c.on('error', () => setStatus('error'))
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
      })
    } catch {
      setStatus('error')
    }

    return () => {
      if (c) { c.end(); setClient(null); setStatus('offline') }
    }
  }, [broker, port, baseTopic])

  // Resolves with the message value as soon as it arrives, or null after timeoutMs.
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

  return { client, status, sensorCache, publish, waitForMessage }
}