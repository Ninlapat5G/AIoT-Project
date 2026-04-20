import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import mqtt from 'mqtt'

import { initialDevices, DEFAULT_SETTINGS, INITIAL_AREAS, INITIAL_TWEAKS } from './data'
import { cookieSave, cookieLoad } from './utils/storage'
import { callAgentRouter, callFinalResponse } from './utils/agent'

import Nav, { MobileTopbar, MobileBottomNav } from './components/Nav'
import DeviceCard, { AddDeviceTile, cardVariants } from './components/DeviceCard'
import ChatPage from './components/ChatPage'
import SettingsPage from './components/SettingsPage'
import TweaksPanel from './components/TweaksPanel'
import Icon from './components/ui/Icon'

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.15 } },
}

const gridVariants = {
  animate: { transition: { staggerChildren: 0.06 } },
}

export default function App() {
  const [tweaks, setTweaks]           = useState(INITIAL_TWEAKS)
  const [tweaksOpen, setTweaksOpen]   = useState(false)
  const [page, setPage]               = useState(() => localStorage.getItem('sh-page') || 'devices')
  const [mobileNavOpen, setMobileNav] = useState(false)

  useEffect(() => { localStorage.setItem('sh-page', page) }, [page])

  // ── Devices ────────────────────────────────────────────────────────────────
  const [devices, setDevices]         = useState(initialDevices)
  const devicesRef                    = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])

  const [areas, setAreas]             = useState(INITIAL_AREAS)
  const [activeArea, setActiveArea]   = useState('All')
  const [editAreas, setEditAreas]     = useState(false)
  const [newArea, setNewArea]         = useState('')

  // ── Chat ────────────────────────────────────────────────────────────────────
  const [messages, setMessages]       = useState([])
  const [apiHistory, setApiHistory]   = useState([])
  const [thinking, setThinking]       = useState(false)
  const [executing, setExecuting]     = useState(null)

  // ── MQTT ────────────────────────────────────────────────────────────────────
  const [mqttClient, setMqttClient]   = useState(null)
  const [sensorCache, setSensorCache] = useState({})

  // ── Settings ────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => {
    const saved = cookieLoad()
    let merged = saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS
    if (merged.mqtt) {
      // Force WSS so the app works on HTTPS deployments (Vercel etc.)
      if (merged.mqtt.broker?.startsWith('ws://')) {
        merged.mqtt.broker = merged.mqtt.broker.replace('ws://', 'wss://').replace(':8000', ':8884')
        merged.mqtt.port   = '8884'
      }
    }
    if (!saved?.prompt_v3) {
      merged.systemPrompt  = DEFAULT_SETTINGS.systemPrompt
      merged.mqtt.baseTopic = 'Mylab/smarthome'
      delete merged.mqtt.topic
      merged.prompt_v3 = true
    }
    return merged
  })

  const handleSaveSettings = useCallback(s => {
    setSettings(s)
    cookieSave(s)
  }, [])

  // ── Apply theme tokens ──────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme   = tweaks.theme
    root.dataset.density = tweaks.density
    root.dataset.grid    = tweaks.showGrid ? 'on' : 'off'
    root.style.setProperty('--accent-h', tweaks.accentHue)
    root.style.setProperty('--accent-c', tweaks.accentChroma)
  }, [tweaks])

// ── MQTT real-time connection ────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.mqtt.broker) return
    let client
    try {
      client = mqtt.connect(settings.mqtt.broker, {
        clientId: 'synapta_web_' + Math.random().toString(16).substring(2, 10),
        keepalive: 30,
        clean: true,
        reconnectPeriod: 5000,
      })

      client.on('connect', () => {
        console.log('[MQTT] Connected to', settings.mqtt.broker)
        client.subscribe(`${settings.mqtt.baseTopic}/#`)
        setMqttClient(client)
      })

      client.on('message', (topic, message) => {
        const val = message.toString()
        console.log(`[MQTT] Received: ${topic} -> ${val}`)
        setSensorCache(prev => ({ ...prev, [topic]: val }))

        setDevices(p =>
          p.map(d => {
            // ดึง Base Topic มาเตรียมประกอบร่าง
            const base = settings.mqtt.baseTopic || ''
            // เช็คว่าถ้า User กรอกมาเต็มอยู่แล้ว ก็ไม่ต้องเติม แต่ถ้ากรอกแค่ Suffix ให้เอา Base ไปต่อหน้า
            const fullSub = d.subTopic?.startsWith(base) ? d.subTopic : `${base}/${d.subTopic}`.replace(/\/\/+/g, '/')
            const fullPub = d.pubTopic?.startsWith(base) ? d.pubTopic : `${base}/${d.pubTopic}`.replace(/\/\/+/g, '/')

            // ตรวจสอบความถูกต้องโดยเทียบจากชื่อเต็ม
            const match =
              (d.subTopic && (topic === fullSub || topic === d.subTopic)) ||
              (d.pubTopic && (topic === fullPub || topic === d.pubTopic))

            if (!match) return d
            if (d.type === 'digital')
              return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
            if (d.type === 'analog')
              return { ...d, value: parseInt(val, 10) || 0 }
            return d
          }),
        )
      })

      client.on('error', (err) => { console.error('[MQTT] Connection Error:', err) })
      client.on('offline', () => { console.warn('[MQTT] Client went offline') })

    } catch (err) {
      console.error('MQTT setup error:', err)
    }
    return () => { if (client) { client.end(); setMqttClient(null) } }
  }, [settings.mqtt.broker, settings.mqtt.baseTopic])

  // ── Device state + MQTT publish ─────────────────────────────────────────────
  const updateDevice = useCallback(
    (next, isFinal = true) => {
      setDevices(p => p.map(d => (d.id === next.id ? next : d)))
      if (mqttClient && next.pubTopic && isFinal !== false) {
        const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
        
        // ประกอบร่างตอน Publish ออกไปให้ด้วย
        const base = settings.mqtt.baseTopic || ''
        const fullTopic = next.pubTopic.startsWith(base)
          ? next.pubTopic
          : `${base}/${next.pubTopic}`.replace(/\/\/+/g, '/')

        mqttClient.publish(fullTopic, payload)
        console.log(`[MQTT] Published: ${fullTopic} -> ${payload}`)
      }
    },
    [mqttClient, settings.mqtt.baseTopic],
  )

  // ── Device state + MQTT publish ─────────────────────────────────────────────
  const updateDevice = useCallback(
    (next, isFinal = true) => {
      setDevices(p => p.map(d => (d.id === next.id ? next : d)))
      if (mqttClient && next.pubTopic && isFinal !== false) {
        const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
        mqttClient.publish(next.pubTopic, payload)
        console.log(`[MQTT] Published: ${next.pubTopic} -> ${payload}`)
      }
    },
    [mqttClient],
  )

  // ── Tool executor ────────────────────────────────────────────────────────────
  const executeTool = useCallback(
    async (name, args) => {
      if (name === 'mqtt_publish') {
        if (!mqttClient) return { success: false, error: 'MQTT Client not connected' }

        let topic   = args?.topic
        let payload = args?.payload
        if (typeof args === 'string') {
          const parts = args.trim().split(/\s+/)
          topic   = parts[0]
          payload = parts.slice(1).join(' ')
        }

        const device   = devicesRef.current.find(d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic))
        const fullTopic = device ? device.pubTopic : topic

        return new Promise(resolve => {
          mqttClient.publish(fullTopic, String(payload), err => {
            if (err) { resolve({ success: false, error: err.message }); return }
            if (device) {
              setDevices(p =>
                p.map(d => {
                  if (d.id !== device.id) return d
                  if (d.type === 'digital') return { ...d, on: payload === 'true' }
                  if (d.type === 'analog')  return { ...d, value: parseInt(payload, 10) || 0 }
                  return d
                }),
              )
            }
            resolve({ success: true, topic: fullTopic, payload, message: 'Message published to broker.' })
          })
        })
      }

      if (name === 'mqtt_read') {
        const topicToRead = typeof args === 'string' ? args.trim() : args?.topic
        const val = sensorCache[topicToRead]
        if (val !== undefined) return { success: true, topic: topicToRead, value: val }
        return { success: false, note: `No data cached for topic: ${topicToRead}` }
      }

      return { success: false, error: `Unknown tool ${name}` }
    },
    [mqttClient, sensorCache, devicesRef],
  )

  // ── Send message (two-phase agent) ──────────────────────────────────────────
  const sendMessage = useCallback(
    async text => {
      if (!settings.apiKey) {
        setMessages(prev => [
          ...prev,
          { role: 'user', text },
          { role: 'ai', text: '⚠️ กรุณาตั้งค่า API Key ในหน้า Settings ก่อนใช้งาน' },
        ])
        return
      }

      setMessages(prev => [...prev, { role: 'user', text }])
      const hist = [...apiHistory, { role: 'user', content: text }]
      setThinking(true)
      setExecuting(null)

      try {
        // Phase A — tool routing
        const agentData = await callAgentRouter({
          text,
          settings,
          deviceList: devicesRef.current.map(d => ({
            id: d.id, name: d.name, room: d.room,
            type: d.type, pubTopic: d.pubTopic, subTopic: d.subTopic,
          })),
        })

        const choice = agentData.choices?.[0]
        if (!choice) throw new Error('API ไม่ส่งผลลัพธ์กลับมา')

        let toolContextStr = ''
        if (choice.message.tool_calls?.length) {
          const toolResults = []
          for (const tc of choice.message.tool_calls) {
            const fnName = tc.function.name
            let args = {}
            try { args = JSON.parse(tc.function.arguments || '{}') } catch { args = tc.function.arguments }

            setExecuting({ name: fnName, args })
            await new Promise(r => setTimeout(r, 600))
            const result = await executeTool(fnName, args)
            setMessages(prev => [...prev, { role: 'tool', name: fnName, args, result }])
            toolResults.push(`Tool ${fnName} result: ` + JSON.stringify(result))
          }
          toolContextStr = toolResults.join('\n')
        }

        setExecuting(null)
        setThinking(true)

        // Phase B — final response
        const finalData = await callFinalResponse({
          text,
          apiHistory,
          settings,
          toolContext: toolContextStr,
          deviceList: devicesRef.current,
        })

        const reply = finalData.choices?.[0]?.message?.content || '...'
        setMessages(prev => [...prev, { role: 'ai', text: reply }])
        setApiHistory([...hist, { role: 'assistant', content: reply }])
      } catch (err) {
        setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${err.message}` }])
      } finally {
        setThinking(false)
        setExecuting(null)
      }
    },
    [apiHistory, settings, executeTool, devicesRef],
  )

  const clearChat = useCallback(() => {
    setMessages([]); setApiHistory([]); setThinking(false); setExecuting(null)
  }, [])

  // ── Tweaks helpers ──────────────────────────────────────────────────────────
  const applyTweaks = patch => setTweaks(p => ({ ...p, ...patch }))

  // ── Stats ────────────────────────────────────────────────────────────────────
  const activeCount = devices.filter(d => (d.type === 'digital' ? d.on : d.value > 0)).length
  const analogDevices = devices.filter(d => d.type === 'analog')
  const analogAvg = analogDevices.length
    ? Math.round(analogDevices.reduce((a, d) => a + d.value, 0) / analogDevices.length)
    : 0
  const roomCount   = new Set(devices.map(d => d.room)).size
  const skillCount  = (settings.skills || []).filter(s => s.enabled).length
  const modelShort  = (settings.model || 'typhoon-v2').split('-instruct')[0]

  const visibleDevices = devices.filter(d => activeArea === 'All' || d.room === activeArea)

  return (
    <div className="sh-app">
      <MobileTopbar
        page={page}
        onOpenMenu={() => setMobileNav(true)}
        tweaks={tweaks}
        onToggleTheme={() => applyTweaks({ theme: tweaks.theme === 'dark' ? 'light' : 'dark' })}
      />

      <div className="sh-app-body">
        <Nav
          page={page} setPage={setPage}
          activeCount={activeCount} deviceCount={devices.length}
          tweaks={tweaks}
          onToggleTheme={() => applyTweaks({ theme: tweaks.theme === 'dark' ? 'light' : 'dark' })}
          onToggleTweaks={() => setTweaksOpen(v => !v)}
          tweaksOpen={tweaksOpen}
          profile={settings.profile}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNav(false)}
        />

        <main className="sh-main">
          <AnimatePresence mode="wait">
            {page === 'devices' && (
              <motion.section
                key="devices"
                className="sh-board"
                {...pageVariants}
              >
                {/* Page header */}
                <div className="sh-page-head">
                  <div>
                    <div className="sh-eyebrow mono">WIDGET BOARD</div>
                    <h1>Devices <span className="sh-h1-count mono">{devices.length}</span></h1>
                    <p className="sh-page-sub">
                      {activeCount} active · {roomCount} rooms · avg {analogAvg}/255
                    </p>
                  </div>
                  <div className="sh-board-filters mono">
                    {['All', ...areas].map(f => (
                      <span key={f} className={`sh-filter-chip ${activeArea === f ? 'on' : ''}`}>
                        <button className="sh-filter-btn" onClick={() => setActiveArea(f)}>{f}</button>
                        {editAreas && f !== 'All' && (
                          <button
                            className="sh-filter-x"
                            onClick={() => {
                              setAreas(areas.filter(a => a !== f))
                              if (activeArea === f) setActiveArea('All')
                            }}
                          >
                            <Icon name="close" size={10} />
                          </button>
                        )}
                      </span>
                    ))}
                    {editAreas && (
                      <form
                        className="sh-filter-add"
                        onSubmit={e => {
                          e.preventDefault()
                          const v = newArea.trim()
                          if (v && !areas.includes(v)) setAreas([...areas, v])
                          setNewArea('')
                        }}
                      >
                        <input
                          value={newArea}
                          onChange={e => setNewArea(e.target.value)}
                          placeholder="New area…"
                        />
                        <button type="submit" disabled={!newArea.trim()}>
                          <Icon name="plus" size={11} />
                        </button>
                      </form>
                    )}
                    <button
                      className={`sh-filter-edit ${editAreas ? 'on' : ''}`}
                      onClick={() => setEditAreas(v => !v)}
                    >
                      {editAreas ? 'Done' : 'Edit'}
                    </button>
                  </div>
                </div>

                {/* Device grid */}
                <motion.div
                  className="sh-grid"
                  variants={gridVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {visibleDevices.map(d => (
                    <DeviceCard
                      key={d.id} device={d}
                      onUpdate={updateDevice}
                      onRemove={id => setDevices(p => p.filter(x => x.id !== id))}
                      areas={areas}
                    />
                  ))}
                  <AddDeviceTile onClick={() => alert('Pair flow จะเปิดที่นี่')} />
                </motion.div>

                <footer className="sh-board-foot mono">
                  <span>◀ · {devices.length} devices across {roomCount} rooms</span>
                  <span className="flex-1" />
                  <span>MQTT: {settings.mqtt.broker}:{settings.mqtt.port}</span>
                </footer>
              </motion.section>
            )}

            {page === 'chat' && (
              <motion.div key="chat" className="h-full" {...pageVariants}>
                <ChatPage
                  messages={messages}
                  onSend={sendMessage}
                  thinking={thinking}
                  executing={executing}
                  onClear={clearChat}
                  modelName={modelShort}
                  skillCount={skillCount}
                  msgCount={apiHistory.length}
                />
              </motion.div>
            )}

            {page === 'settings' && (
              <motion.div key="settings" {...pageVariants}>
                <SettingsPage settings={settings} onSave={handleSaveSettings} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <MobileBottomNav
        page={page} setPage={setPage}
        activeCount={activeCount} deviceCount={devices.length}
      />
      <TweaksPanel open={tweaksOpen} tweaks={tweaks} onChange={applyTweaks} />
    </div>
  )
}
