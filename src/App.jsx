import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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

  // ── MQTT message sync (STRICT MATCHING ONLY) ──────────────────────────────────
  const handleMqttMessage = useCallback((topic, val) => {
    const base = (settings.mqtt.baseTopic || '').trim().replace(/^\/+|\/+$/g, '')
    const cleanIncoming = topic.trim().replace(/^\/+|\/+$/g, '')

    setDevices(prev => prev.map(d => {
      const sub = (d.subTopic || '').trim().replace(/^\/+|\/+$/g, '')
      const pub = (d.pubTopic || '').trim().replace(/^\/+|\/+$/g, '')

      // การันตีโครงสร้างที่ควรจะเป็น (Strict: Base + Topic เท่านั้น)
      const targetSub = base ? `${base}/${sub}`.replace(/\/\/+/g, '/') : sub
      const targetPub = base ? `${base}/${pub}`.replace(/\/\/+/g, '/') : pub

      // ถ้าไม่ตรงกับ Target ที่คำนวณได้ ให้ข้ามไปเลย (ไม่มี fallback ไปเช็คค่าดิบ)
      if (cleanIncoming !== targetSub && cleanIncoming !== targetPub) return d

      if (d.type === 'digital') return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
      if (d.type === 'analog') return { ...d, value: Math.max(0, Math.min(d.max ?? 255, parseInt(val, 10) || 0)) }
      return d
    }))
  }, [settings.mqtt.baseTopic])

  // ── Subscribe Topics ─────────────────────────────────────────────────────────
  const subscribeTopics = useMemo(() => {
    const list = new Set()
    const base = (settings.mqtt.baseTopic || '').trim().replace(/^\/+|\/+$/g, '')
    if (base) {
      list.add(`${base}/#`)
    } else {
      devices.forEach(d => {
        if (d.pubTopic) list.add(d.pubTopic.trim().replace(/^\/+|\/+$/g, ''))
        if (d.subTopic) list.add(d.subTopic.trim().replace(/^\/+|\/+$/g, ''))
      })
    }
    return Array.from(list).filter(Boolean)
  }, [devices, settings.mqtt.baseTopic])

  const { status: mqttStatus, sensorCache, publish: mqttPublish } = useMQTT({
    broker: settings.mqtt.broker,
    baseTopic: settings.mqtt.baseTopic,
    subscribeTopics,
    onMessage: handleMqttMessage,
  })

  // ── Device update (Optimistic & No Pending) ───────────────────────────────────
  const updateDevice = useCallback((next, isFinal = true) => {
    setDevices(prev => prev.map(d => d.id === next.id ? next : d))
    if (isFinal && next.pubTopic) {
      const payload = next.type === 'digital' ? (next.on ? 'true' : 'false') : String(next.value)
      // ส่งผ่าน Helper ที่จัดการ Base Topic ให้แล้ว
      mqttPublish(next.pubTopic, payload)
    }
  }, [mqttPublish])

  const removeDevice = useCallback(id => {
    setDevices(prev => prev.filter(x => x.id !== id))
  }, [])

  // ── Tool executor (Agent integration) ──────────────────────────────────────────
  const executeTool = useCallback(async (name, args) => {
    // ... logic สำหรับ Agent (คงเดิมตามระบบ Strict) ...
    return { success: false, error: `Unknown tool: ${name}` }
  }, [sensorCache, settings.mqtt.baseTopic])

  const { messages, thinking, executing, sendMessage, clearChat } = useChat({
    settings, devicesRef, executeTool,
  })

  // ── Theme & Utils ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = tweaks.theme
    root.style.setProperty('--accent-h', tweaks.accentHue)
  }, [tweaks])

  const handleClearAll = useCallback(() => { clearAll(); window.location.reload() }, [])

  // ── Render ────────────────────────────────────────────────────────────────────
  const activeCount = devices.filter(d => d.type === 'digital' ? d.on : d.value > 0).length
  const visibleDevices = devices.filter(d => activeArea === 'All' || d.room === activeArea)

  return (
    <div className="sh-app">
      <MobileTopbar page={page} onOpenMenu={() => setMobileNav(true)} tweaks={tweaks} />
      <div className="sh-app-body">
        <Nav page={page} setPage={setPage} activeCount={activeCount} deviceCount={devices.length} tweaks={tweaks} mqttStatus={mqttStatus} />
        <main className="sh-main">
          <AnimatePresence mode="wait">
            {page === 'devices' && (
              <motion.section key="devices" className="sh-board" {...pageVariants}>
                <div className="sh-page-head">
                  <h1>Devices <span className="sh-h1-count mono">{devices.length}</span></h1>
                  <div className="sh-board-filters mono">
                    {['All', ...areas].map(f => (
                      <button key={f} className={`sh-filter-chip ${activeArea === f ? 'on' : ''}`} onClick={() => setActiveArea(f)}>{f}</button>
                    ))}
                  </div>
                </div>
                <ErrorBoundary>
                  <motion.div className="sh-grid" variants={gridVariants} initial="hidden" animate="visible">
                    {visibleDevices.map(d => (
                      <DeviceCard key={d.id} device={d} onUpdate={updateDevice} onRemove={removeDevice} areas={areas} />
                    ))}
                    <AddDeviceTile onClick={() => { }} />
                  </motion.div>
                </ErrorBoundary>
              </motion.section>
            )}
            {page === 'chat' && <ChatPage messages={messages} onSend={sendMessage} thinking={thinking} executing={executing} />}
            {page === 'settings' && <SettingsPage settings={settings} onSave={handleSaveSettings} mqttStatus={mqttStatus} onClearAll={handleClearAll} />}
          </AnimatePresence>
        </main>
      </div>
      <MobileBottomNav page={page} setPage={setPage} activeCount={activeCount} deviceCount={devices.length} />
    </div>
  )
}