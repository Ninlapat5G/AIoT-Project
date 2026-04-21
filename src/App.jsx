import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import mqtt from 'mqtt'

import { initialDevices, DEFAULT_SETTINGS, INITIAL_AREAS, INITIAL_TWEAKS } from './data'
import { saveSettings, loadSettings, saveDevices, loadDevices, saveAreas, loadAreas, clearAll } from './utils/storage'
import { runAgent } from './utils/agent'

import Nav, { MobileTopbar, MobileBottomNav } from './components/Nav'
import DeviceCard, { AddDeviceTile } from './components/DeviceCard'
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

  // ── Settings ─────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings()
    if (!saved) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...saved, mqtt: { ...DEFAULT_SETTINGS.mqtt, ...saved.mqtt } }
  })

  const handleSaveSettings = useCallback(s => {
    setSettings(s)
    saveSettings(s)
  }, [])

  // ── Devices ───────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState(() => loadDevices() ?? initialDevices)
  const devicesRef            = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])
  useEffect(() => { saveDevices(devices) }, [devices])

  // ── Areas ─────────────────────────────────────────────────────────────────────
  const [areas, setAreas]         = useState(() => loadAreas() ?? INITIAL_AREAS)
  const [activeArea, setActiveArea] = useState('All')
  const [editAreas, setEditAreas] = useState(false)
  const [newArea, setNewArea]     = useState('')
  useEffect(() => { saveAreas(areas) }, [areas])

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const [messages, setMessages]   = useState([])
  const [apiHistory, setApiHistory] = useState([])
  const [thinking, setThinking]   = useState(false)
  const [executing, setExecuting] = useState(null)

  // ── MQTT ──────────────────────────────────────────────────────────────────────
  const [mqttClient, setMqttClient]   = useState(null)
  const [mqttStatus, setMqttStatus]   = useState('connecting')
  const [sensorCache, setSensorCache] = useState({})

  useEffect(() => {
    if (!settings.mqtt.broker) { setMqttStatus('offline'); return }

    setMqttStatus('connecting')
    let client

    try {
      client = mqtt.connect(settings.mqtt.broker, {
        clientId:      'synapta_web_' + Math.random().toString(16).substring(2, 10),
        keepalive:     30,
        clean:         true,
        reconnectPeriod: 5000,
      })

      client.on('connect', () => {
        setMqttStatus('connected')
        setMqttClient(client)
        // QoS 2 subscription — broker delivers retained messages immediately on subscribe,
        // giving us the current device state without any additional request.
        client.subscribe(`${settings.mqtt.baseTopic}/#`, { qos: 2 })
      })

      client.on('reconnect', () => setMqttStatus('reconnecting'))
      client.on('error',     () => setMqttStatus('error'))
      client.on('offline',   () => setMqttStatus('offline'))
      client.on('close',     () => { setMqttStatus('offline'); setMqttClient(null) })

      client.on('message', (topic, message) => {
        const val = message.toString()
        setSensorCache(prev => ({ ...prev, [topic]: val }))

        setDevices(prev => prev.map(d => {
          const base    = settings.mqtt.baseTopic || ''
          const fullSub = d.subTopic?.startsWith(base) ? d.subTopic : `${base}/${d.subTopic}`.replace(/\/\/+/g, '/')
          const fullPub = d.pubTopic?.startsWith(base) ? d.pubTopic : `${base}/${d.pubTopic}`.replace(/\/\/+/g, '/')
          const matched = (topic === fullSub || topic === d.subTopic) ||
                          (topic === fullPub || topic === d.pubTopic)
          if (!matched) return d
          if (d.type === 'digital') return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
          if (d.type === 'analog')  return { ...d, value: parseInt(val, 10) || 0 }
          return d
        }))
      })
    } catch {
      setMqttStatus('error')
    }

    return () => {
      if (client) { client.end(); setMqttClient(null); setMqttStatus('offline') }
    }
  }, [settings.mqtt.broker, settings.mqtt.baseTopic])

  // ── Theme tokens ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme   = tweaks.theme
    root.dataset.density = tweaks.density
    root.dataset.grid    = tweaks.showGrid ? 'on' : 'off'
    root.style.setProperty('--accent-h', tweaks.accentHue)
    root.style.setProperty('--accent-c', tweaks.accentChroma)
  }, [tweaks])

  // ── Device update + MQTT publish ──────────────────────────────────────────────
  const mqttPublish = useCallback((topic, payload, opts = {}) => {
    if (!mqttClient) return
    const base      = settings.mqtt.baseTopic || ''
    const fullTopic = topic.startsWith(base) ? topic : `${base}/${topic}`.replace(/\/\/+/g, '/')
    mqttClient.publish(fullTopic, String(payload), { qos: 2, ...opts })
    return fullTopic
  }, [mqttClient, settings.mqtt.baseTopic])

  const updateDevice = useCallback((next, isFinal = true) => {
    setDevices(prev => prev.map(d => d.id === next.id ? next : d))
    if (isFinal && next.pubTopic) {
      const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
      mqttPublish(next.pubTopic, payload)
    }
  }, [mqttPublish])

  // ── Tool executor (called by agent graph) ─────────────────────────────────────
  const executeTool = useCallback(async (name, args) => {
    if (name === 'mqtt_publish') {
      if (!mqttClient) return { success: false, error: 'MQTT not connected' }

      const topic   = args?.topic
      const payload = args?.payload
      const device  = devicesRef.current.find(d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic))
      const rawTopic = device ? device.pubTopic : topic

      return new Promise(resolve => {
        const base      = settings.mqtt.baseTopic || ''
        const fullTopic = rawTopic.startsWith(base) ? rawTopic : `${base}/${rawTopic}`.replace(/\/\/+/g, '/')
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

    if (name === 'mqtt_read') {
      const topic = typeof args === 'string' ? args.trim() : args?.topic
      if (!topic) return { success: false, error: 'No topic specified' }
      const base      = settings.mqtt.baseTopic || ''
      const fullTopic = topic.startsWith(base) ? topic : `${base}/${topic}`.replace(/\/\/+/g, '/')
      const val       = sensorCache[fullTopic]
      if (val !== undefined) return { success: true, topic: fullTopic, value: val }
      return { success: false, note: `No data cached for topic: ${fullTopic}` }
    }

    return { success: false, error: `Unknown tool: ${name}` }
  }, [mqttClient, sensorCache, settings.mqtt.baseTopic])

  // ── Send message (streaming agent graph) ──────────────────────────────────────
  const sendMessage = useCallback(async text => {
    if (!settings.apiKey) {
      setMessages(prev => [
        ...prev,
        { role: 'user', text },
        { role: 'ai', text: '⚠️ กรุณาตั้งค่า API Key ในหน้า Settings ก่อนใช้งาน' },
      ])
      return
    }

    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)
    setExecuting(null)

    try {
      const { reply } = await runAgent({
        text,
        settings,
        deviceList: devicesRef.current,
        apiHistory,
        executeTool,
        onToolCall: (name, args) => {
          setThinking(false)
          setExecuting({ name, args })
        },
        onToolResult: (name, args, result) => {
          setExecuting(null)
          setThinking(true)
          setMessages(prev => [...prev, { role: 'tool', name, args, result }])
        },
        onStream: chunk => {
          setThinking(false)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'ai' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + chunk }]
            }
            return [...prev, { role: 'ai', text: chunk, streaming: true }]
          })
        },
      })

      // Finalise streaming message
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'ai' && last?.streaming) {
          return [...prev.slice(0, -1), { role: 'ai', text: last.text }]
        }
        if (reply && last?.role !== 'ai') {
          return [...prev, { role: 'ai', text: reply }]
        }
        return prev
      })

      setApiHistory(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ])
    } catch (err) {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        const base = last?.streaming ? prev.slice(0, -1) : prev
        return [...base, { role: 'ai', text: `⚠️ ${err.message}` }]
      })
    } finally {
      setThinking(false)
      setExecuting(null)
    }
  }, [apiHistory, settings, executeTool])

  const clearChat = useCallback(() => {
    setMessages([]); setApiHistory([]); setThinking(false); setExecuting(null)
  }, [])

  // ── Clear all local data ───────────────────────────────────────────────────────
  const handleClearAll = useCallback(() => {
    clearAll()
    window.location.reload()
  }, [])

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const activeCount   = devices.filter(d => d.type === 'digital' ? d.on : d.value > 0).length
  const analogDevices = devices.filter(d => d.type === 'analog')
  const analogAvg     = analogDevices.length
    ? Math.round(analogDevices.reduce((a, d) => a + d.value, 0) / analogDevices.length)
    : 0
  const roomCount     = new Set(devices.map(d => d.room)).size
  const skillCount    = (settings.skills || []).filter(s => s.enabled).length
  const modelShort    = (settings.model || 'typhoon-v2').split('-instruct')[0]

  const visibleDevices = devices.filter(d => activeArea === 'All' || d.room === activeArea)

  return (
    <div className="sh-app">
      <MobileTopbar
        page={page}
        onOpenMenu={() => setMobileNav(true)}
        tweaks={tweaks}
        onToggleTheme={() => setTweaks(t => ({ ...t, theme: t.theme === 'dark' ? 'light' : 'dark' }))}
      />

      <div className="sh-app-body">
        <Nav
          page={page} setPage={setPage}
          activeCount={activeCount} deviceCount={devices.length}
          tweaks={tweaks}
          onToggleTheme={() => setTweaks(t => ({ ...t, theme: t.theme === 'dark' ? 'light' : 'dark' }))}
          onToggleTweaks={() => setTweaksOpen(v => !v)}
          tweaksOpen={tweaksOpen}
          profile={settings.profile}
          mqttStatus={mqttStatus}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNav(false)}
        />

        <main className="sh-main">
          <AnimatePresence mode="wait">
            {page === 'devices' && (
              <motion.section key="devices" className="sh-board" {...pageVariants}>
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

                <motion.div className="sh-grid" variants={gridVariants} initial="hidden" animate="visible">
                  {visibleDevices.map(d => (
                    <DeviceCard
                      key={d.id} device={d}
                      onUpdate={updateDevice}
                      onRemove={id => setDevices(prev => prev.filter(x => x.id !== id))}
                      areas={areas}
                    />
                  ))}
                  <AddDeviceTile
                    onClick={() => {
                      const id = 'dev-' + Date.now().toString(36)
                      setDevices(prev => [...prev, {
                        id, name: 'New Device', room: areas[0] || 'Living Room',
                        type: 'digital', on: false, icon: 'bulb',
                        pubTopic: `${settings.mqtt.baseTopic}/${id}/set`,
                        subTopic: `${settings.mqtt.baseTopic}/${id}/state`,
                      }])
                    }}
                  />
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
                <SettingsPage
                  settings={settings}
                  onSave={handleSaveSettings}
                  mqttStatus={mqttStatus}
                  onClearAll={handleClearAll}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <MobileBottomNav
        page={page} setPage={setPage}
        activeCount={activeCount} deviceCount={devices.length}
      />
      <TweaksPanel open={tweaksOpen} tweaks={tweaks} onChange={patch => setTweaks(t => ({ ...t, ...patch }))} />
    </div>
  )
}
