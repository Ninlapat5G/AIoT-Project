import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { initialDevices, DEFAULT_SETTINGS, INITIAL_AREAS, INITIAL_TWEAKS } from './data'
import { saveSettings, loadSettings, saveDevices, loadDevices, saveAreas, loadAreas, clearAll } from './utils/storage'
import { decodePayload, applyPayload } from './utils/qrshare'
import { useMQTT } from './hooks/useMQTT'
import { useChat } from './hooks/useChat'

import Nav, { MobileTopbar, MobileBottomNav } from './components/Nav'
import DeviceCard, { AddDeviceTile } from './components/DeviceCard'
import ChatPage from './components/ChatPage'
import SettingsPage from './components/SettingsPage'
import TweaksPanel from './components/TweaksPanel'
import QRShareModal from './components/QRShareModal'
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
  const [qrOpen, setQrOpen] = useState(false)
  const [qrMode, setQrMode] = useState('share')

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

  // ── Optimistic pending state ───────────────────────────────────────────────────
  const [pendingIds, setPendingIds] = useState(new Set())
  const pendingTimers = useRef({})
  useEffect(() => () => Object.values(pendingTimers.current).forEach(clearTimeout), [])

  // ── MQTT message → device state sync ─────────────────────────────────────────
  const handleMqttMessage = useCallback((topic, val) => {
    const base = settings.mqtt.baseTopic || ''

    // 1. หาอุปกรณ์ที่ตรงกับ Topic แบบ Synchronous จาก devicesRef
    const matchedDevices = devicesRef.current.filter(d => {
      const fullSub = d.subTopic?.startsWith(base) ? d.subTopic : `${base}/${d.subTopic}`.replace(/\/\/+/g, '/')
      const fullPub = d.pubTopic?.startsWith(base) ? d.pubTopic : `${base}/${d.pubTopic}`.replace(/\/\/+/g, '/')
      return (topic === fullSub || topic === d.subTopic) || (topic === fullPub || topic === d.pubTopic)
    })

    if (matchedDevices.length === 0) return

    // 2. เคลียร์ Pending ทันทีเมื่อเจออุปกรณ์ที่ส่งค่าตรงกันมา
    matchedDevices.forEach(d => {
      clearTimeout(pendingTimers.current[d.id])
      delete pendingTimers.current[d.id]
    })

    setPendingIds(s => {
      const n = new Set(s)
      matchedDevices.forEach(d => n.delete(d.id))
      return n
    })

    // 3. สั่งอัปเดต UI ของ Device
    setDevices(prev => prev.map(d => {
      const isMatch = matchedDevices.some(m => m.id === d.id)
      if (!isMatch) return d
      if (d.type === 'digital') return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
      if (d.type === 'analog') return { ...d, value: Math.max(0, Math.min(d.max ?? 255, parseInt(val, 10) || 0)) }
      return d
    }))
  }, [settings.mqtt.baseTopic])

  // ── MQTT hook ─────────────────────────────────────────────────────────────────
  const { client: mqttClient, status: mqttStatus, sensorCache, publish: mqttPublish } = useMQTT({
    broker: settings.mqtt.broker,
    baseTopic: settings.mqtt.baseTopic,
    onMessage: handleMqttMessage,
  })

  // ── Device update + MQTT publish ──────────────────────────────────────────────
  const updateDevice = useCallback((next, isFinal = true) => {
    setDevices(prev => prev.map(d => d.id === next.id ? next : d))
    if (isFinal && next.pubTopic) {
      const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
      mqttPublish(next.pubTopic, payload)

      setPendingIds(s => new Set([...s, next.id]))
      clearTimeout(pendingTimers.current[next.id])
      pendingTimers.current[next.id] = setTimeout(() => {
        setPendingIds(s => { const n = new Set(s); n.delete(next.id); return n })
        delete pendingTimers.current[next.id]
      }, 3000)
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
        const base = settings.mqtt.baseTopic || ''
        const fullTopic = rawTopic.startsWith(base) ? rawTopic : `${base}/${rawTopic}`.replace(/\/\/+/g, '/')
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
      const base = settings.mqtt.baseTopic || ''
      const fullTopic = topic.startsWith(base) ? topic : `${base}/${topic}`.replace(/\/\/+/g, '/')
      const val = sensorCache[fullTopic]
      if (val !== undefined) return { success: true, topic: fullTopic, value: val }
      return { success: false, note: `No data cached for topic: ${fullTopic}` }
    }

    return { success: false, error: `Unknown tool: ${name}` }
  }, [mqttClient, sensorCache, settings.mqtt.baseTopic])

  // ── Chat hook ─────────────────────────────────────────────────────────────────
  const { messages, thinking, executing, sendMessage, clearChat } = useChat({
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

  // ── QR Share / Import ─────────────────────────────────────────────────────────
  const openQR = useCallback(mode => { setQrMode(mode); setQrOpen(true) }, [])

  const handleScanned = useCallback(rawText => {
    const result = decodePayload(rawText)
    if (!result.ok) {
      setToast({ type: 'error', text: result.error })
      setTimeout(() => setToast(null), 3500)
      return
    }
    const applied = applyPayload({
      payload: result.payload,
      settings,
      devices: devicesRef.current,
      tweaks,
    })
    setSettings(applied.settings)
    saveSettings(applied.settings)
    setDevices(applied.devices)
    setTweaks(applied.tweaks)
    setToast({ type: 'ok', text: `Import สำเร็จ: ${applied.summary.join(' · ')}` })
    setTimeout(() => setToast(null), 4000)
  }, [settings, tweaks])

  // ── Clear all local data ───────────────────────────────────────────────────────
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
                        isPending={pendingIds.has(d.id)}
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
                  <SettingsPage
                    settings={settings}
                    onSave={handleSaveSettings}
                    mqttStatus={mqttStatus}
                    onClearAll={handleClearAll}
                    onOpenQR={openQR}
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

      <QRShareModal
        open={qrOpen}
        mode={qrMode}
        onClose={() => setQrOpen(false)}
        settings={settings}
        devices={devices}
        tweaks={tweaks}
        onScanned={handleScanned}
      />

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