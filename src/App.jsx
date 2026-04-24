import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { initialDevices, DEFAULT_SETTINGS, INITIAL_AREAS, INITIAL_TWEAKS } from './data'
import { saveSettings, loadSettings, saveDevices, loadDevices, saveAreas, loadAreas, clearAll } from './utils/storage'
import { normalizeBase, buildFullTopic } from './utils/mqttTopic'
import { generateOsCommand } from './utils/agent'
import { useMQTT } from './hooks/useMQTT'
import { useChat } from './hooks/useChat'

import Nav, { MobileTopbar, MobileBottomNav } from './components/Nav'
import DeviceCard, { AddDeviceTile, AddTerminalTile } from './components/DeviceCard'
import ChatPage from './components/ChatPage'
import SettingsPage from './components/SettingsPage'
import TweaksPanel from './components/TweaksPanel'
import ErrorBoundary from './components/ErrorBoundary'
import Icon from './components/ui/Icon'

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
}

const gridVariants = {
  animate: { transition: { staggerChildren: 0.06 } },
}

export default function App() {
  const [tweaks, setTweaks] = useState(INITIAL_TWEAKS)
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const [page, setPage] = useState(() => localStorage.getItem('sh-page') || 'devices')
  const [mobileNavOpen, setMobileNav] = useState(false)
  const [toast, setToast] = useState(null)

  // 🗑️ โละ State ของ QR ออกไปแล้วฮะ

  useEffect(() => { localStorage.setItem('sh-page', page) }, [page])

  // ── Settings ──────────────────────────────────────────────────────────────────
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
  const devicesRef = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])
  useEffect(() => { saveDevices(devices) }, [devices])

  // ── Areas ─────────────────────────────────────────────────────────────────────
  const [areas, setAreas] = useState(() => loadAreas() ?? INITIAL_AREAS)
  const [activeArea, setActiveArea] = useState('All')
  const [editAreas, setEditAreas] = useState(false)
  const [newArea, setNewArea] = useState('')
  useEffect(() => { saveAreas(areas) }, [areas])

  // ── MQTT baseTopic ref (always-fresh, avoids stale closure) ──────────────────
  const baseTopicRef = useRef(settings.mqtt.baseTopic)
  useEffect(() => { baseTopicRef.current = settings.mqtt.baseTopic }, [settings.mqtt.baseTopic])

  // ── MQTT message sync ─────────────────────────────────────────────────────────
  const handleMqttMessage = useCallback((topic, val) => {
    const base = normalizeBase(baseTopicRef.current)
    const incoming = topic.trim()

    setDevices(prev => {
      let matched = false
      const next = prev.map(d => {
        if (incoming !== buildFullTopic(d.subTopic, base) &&
          incoming !== buildFullTopic(d.pubTopic, base)) return d
        matched = true
        if (d.type === 'digital') return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
        if (d.type === 'analog') return { ...d, value: Math.max(0, Math.min(d.max ?? 255, parseInt(val, 10) || 0)) }
        return d
      })
      return matched ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── MQTT hook ─────────────────────────────────────────────────────────────────
  const { client: mqttClient, status: mqttStatus, sensorCache, publish: mqttPublish, waitForMessage: mqttWaitForMessage } = useMQTT({
    broker: settings.mqtt.broker,
    port: settings.mqtt.port, // ✨ ส่ง port เข้าไปด้วยเผื่อลืม
    baseTopic: settings.mqtt.baseTopic,
    onMessage: handleMqttMessage,
  })

  // ── Device update (No Pending/Waiting) ──────────────────────────────────────
  const updateDevice = useCallback((next, isFinal = true) => {
    setDevices(prev => prev.map(d => d.id === next.id ? next : d))
    if (isFinal && next.pubTopic) {
      const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
      mqttPublish(next.pubTopic, payload)
    }
  }, [mqttPublish])

  const removeDevice = useCallback(id => {
    setDevices(prev => prev.filter(x => x.id !== id))
  }, [])

  // ── Tool executor (called by agent) ───────────────────────────────────────────
  const executeTool = useCallback(async (name, args) => {
    if (name === 'mqtt_publish') {
      if (!mqttClient) return { success: false, error: 'MQTT not connected' }

      const topic = args?.topic
      const payload = args?.payload
      const device = devicesRef.current.find(d => d.pubTopic === topic || d.pubTopic?.endsWith('/' + topic))
      const rawTopic = device ? device.pubTopic : topic

      return new Promise(resolve => {
        const base = normalizeBase(baseTopicRef.current)
        const fullTopic = buildFullTopic(rawTopic, base)

        mqttClient.publish(fullTopic, String(payload), { qos: 2 }, err => {
          if (err) { resolve({ success: false, error: err.message }); return }
          if (device) {
            setDevices(prev => prev.map(d => {
              if (d.id !== device.id) return d
              if (d.type === 'digital') return { ...d, on: payload === 'true' }
              if (d.type === 'analog') return { ...d, value: parseInt(payload, 10) || 0 }
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
      const base = normalizeBase(baseTopicRef.current)
      const fullTopic = buildFullTopic(topic, base)
      const val = sensorCache[fullTopic]
      if (val !== undefined) return { success: true, topic: fullTopic, value: val }
      return { success: false, note: `No data cached for topic: ${fullTopic}` }
    }

    if (name === 'os_command') {
      const { instruction, os, topic } = args
      if (!mqttClient) return { success: false, error: 'MQTT not connected' }
      if (!instruction || !os || !topic) return { success: false, error: 'Missing args: instruction, os, topic' }

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
      const outputTopic = args.wait_output && device?.subTopic ? buildFullTopic(device.subTopic, base) : null

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

    return { success: false, error: `Unknown tool: ${name}` }
  }, [mqttClient, sensorCache, settings, mqttWaitForMessage])

  // ── Raw MQTT publish (used by OsTerminalCard widget) ─────────────────────────
  const handleRawPublish = useCallback((topic, payload) => {
    if (!mqttClient || !topic) return
    const base = normalizeBase(baseTopicRef.current)
    const fullTopic = buildFullTopic(topic, base)
    mqttClient.publish(fullTopic, String(payload), { qos: 2 })
  }, [mqttClient])

  // ── Chat hook ─────────────────────────────────────────────────────────────────
  // ✨ มักดึง stopChat ออกมาแล้วนะฮะ!
  const { messages, thinking, executing, sendMessage, clearChat, stopChat } = useChat({
    settings,
    devicesRef,
    executeTool,
  })

  // ── Theme tokens ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = tweaks.theme
    root.dataset.density = tweaks.density
    root.dataset.grid = tweaks.showGrid ? 'on' : 'off'
    root.style.setProperty('--accent-h', tweaks.accentHue)
    root.style.setProperty('--accent-c', tweaks.accentChroma)
  }, [tweaks])

  // ── Offline detection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const showToast = (type, text) => {
      setToast({ type, text })
      setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000)
    }
    const onOffline = () => showToast('error', 'ออฟไลน์ — ไม่สามารถควบคุมอุปกรณ์ได้')
    const onOnline = () => showToast('ok', 'เชื่อมต่ออินเตอร์เน็ตแล้ว')
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const handleClearAll = useCallback(() => {
    clearAll()
    window.location.reload()
  }, [])

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const activeCount = devices.filter(d => d.type === 'digital' ? d.on : d.value > 0).length
  const analogDevices = devices.filter(d => d.type === 'analog')
  const analogAvg = analogDevices.length
    ? Math.round(analogDevices.reduce((a, d) => a + d.value, 0) / analogDevices.length)
    : 0
  const roomCount = new Set(devices.map(d => d.room)).size
  const skillCount = (settings.skills || []).filter(s => s.enabled).length
  const modelShort = (settings.model || 'typhoon-v2').split('-instruct')[0]

  const visibleDevices = devices.filter(d => activeArea === 'All' || d.room === activeArea)

  const mqttUnhealthy = mqttStatus === 'reconnecting' || mqttStatus === 'error'

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
          {mqttUnhealthy && (
            <div className={`sh-mqtt-banner ${mqttStatus === 'error' ? 'error' : ''}`}>
              <span style={{ animation: 'pulse-dot 1s ease-in-out infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
              {mqttStatus === 'reconnecting' ? '↻ กำลังเชื่อมต่อ MQTT ใหม่...' : '⚠ MQTT เกิดข้อผิดพลาด — ตรวจสอบ Settings'}
            </div>
          )}

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

                <ErrorBoundary>
                  <motion.div className="sh-grid" variants={gridVariants} initial="hidden" animate="visible">
                    {visibleDevices.map(d => (
                      <DeviceCard
                        key={d.id}
                        device={d}
                        onUpdate={updateDevice}
                        onRemove={removeDevice}
                        areas={areas}
                        onRawPublish={handleRawPublish}
                      />
                    ))}
                    <AddDeviceTile
                      onClick={() => {
                        const id = 'dev-' + Date.now().toString(36)
                        setDevices(prev => [...prev, {
                          id, name: 'New Device', room: areas[0] || 'Living Room',
                          type: 'digital', on: false, icon: 'bulb',
                          pubTopic: `${id}/set`,
                          subTopic: `${id}/state`,
                        }])
                      }}
                    />
                    <AddTerminalTile
                      onClick={() => {
                        const id = 'term-' + Date.now().toString(36)
                        setDevices(prev => [...prev, {
                          id, name: 'Terminal', room: areas[0] || 'Living Room',
                          type: 'os_terminal', os: 'windows', icon: 'terminal',
                          pubTopic: `${id}/cmd`,
                          subTopic: `${id}/output`,
                        }])
                      }}
                    />
                  </motion.div>
                </ErrorBoundary>

                <footer className="sh-board-foot mono">
                  <span>◀ · {devices.length} devices across {roomCount} rooms</span>
                  <span className="flex-1" />
                  <span>MQTT: {settings.mqtt.broker}:{settings.mqtt.port}</span>
                </footer>
              </motion.section>
            )}

            {page === 'chat' && (
              <motion.div key="chat" className="h-full" {...pageVariants}>
                <ErrorBoundary>
                  <ChatPage
                    messages={messages}
                    onSend={sendMessage}
                    onStop={stopChat} // ✨ ใส่ onStop เข้าไปให้ ChatPage แล้วฮะ ปุ่มใช้งานได้แน่นอน!
                    thinking={thinking}
                    executing={executing}
                    onClear={clearChat}
                    modelName={modelShort}
                    skillCount={skillCount}
                    msgCount={messages.filter(m => m.role === 'user').length}
                  />
                </ErrorBoundary>
              </motion.div>
            )}

            {page === 'settings' && (
              <motion.div key="settings" {...pageVariants}>
                <ErrorBoundary>
                  {/* 🗑️ ถอด onOpenQR ออก เพราะหน้า Setting เราเป็น JSON หมดแล้ว */}
                  <SettingsPage
                    settings={settings}
                    onSave={handleSaveSettings}
                    mqttStatus={mqttStatus}
                    onClearAll={handleClearAll}
                  />
                </ErrorBoundary>
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

      {/* 🗑️ ลบ Component QRShareModal ทิ้งไปเลย สะอาดตา! */}

      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            className={`sh-toast ${toast.type}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <Icon name={toast.type === 'ok' ? 'check' : 'alert'} size={14} />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}