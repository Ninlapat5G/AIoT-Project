import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createSimulator } from '../utils/iotSimulator'
import Icon from './ui/Icon'

export default function SimulatorPanel({ settings, onClose }) {
  const [simName, setSimName]   = useState('ไฟห้องนอน')
  const [simTopic, setSimTopic] = useState('bedroom/light')
  const [simType, setSimType]   = useState('digital')
  const [simStatus, setSimStatus] = useState('idle')
  const [logs, setLogs]         = useState([])

  const simRef = useRef(null)
  const logsEndRef = useRef(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // cleanup เมื่อ panel ปิด
  useEffect(() => {
    return () => { simRef.current?.disconnect() }
  }, [])

  const addLog = useCallback(msg => {
    setLogs(prev => [...prev.slice(-99), msg])
  }, [])

  const handleConnect = () => {
    if (!simTopic.trim()) return

    // ปุ่ม Connect กดซ้ำได้ตอนสถานะ error/offline — ต้องตัด client เก่าก่อน
    // ไม่งั้น client เก่าจะพยายาม reconnect ค้างอยู่เบื้องหลังพร้อมกับตัวใหม่
    simRef.current?.disconnect()

    simRef.current = createSimulator({
      broker:     settings.mqtt?.broker   || 'broker.hivemq.com',
      port:       settings.mqtt?.port     || '',
      baseTopic:  settings.mqtt?.baseTopic || '',
      name:       simName || simTopic,
      topic:      simTopic.trim(),
      type:       simType,
      onLog:      addLog,
      onStatusChange: setSimStatus,
    })
    simRef.current.connect()
  }

  const handleDisconnect = () => {
    simRef.current?.disconnect()
    simRef.current = null
  }

  const handlePowerLoss = () => {
    simRef.current?.powerLoss()
    simRef.current = null
  }

  const isOnline = simStatus === 'online'

  const statusColor = {
    online:     'var(--accent)',
    offline:    'oklch(0.65 0.22 25)',
    connecting: 'oklch(0.75 0.18 55)',
    error:      'oklch(0.65 0.22 25)',
    idle:       'var(--ink-xdim)',
  }[simStatus] || 'var(--ink-xdim)'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'oklch(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          width: 420,
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="sparkle" size={16} />
          <span style={{ fontWeight: 600, flex: 1 }}>Simulate Device</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-dim)', padding: 4 }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {/* Config */}
          <label className="sh-field">
            <span className="mono">NAME</span>
            <input value={simName} onChange={e => setSimName(e.target.value)} disabled={isOnline} />
          </label>
          <label className="sh-field">
            <span className="mono">TOPIC</span>
            <input
              value={simTopic}
              onChange={e => setSimTopic(e.target.value)}
              placeholder="bedroom/light"
              className="mono"
              disabled={isOnline}
            />
          </label>
          <label className="sh-field">
            <span className="mono">TYPE</span>
            <div className="sh-seg flex">
              {['digital', 'analog'].map(t => (
                <button
                  key={t} type="button"
                  className={simType === t ? 'on' : ''}
                  onClick={() => setSimType(t)}
                  disabled={isOnline}
                >
                  {t}
                </button>
              ))}
            </div>
          </label>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-dim)', textTransform: 'uppercase' }}>
              {simStatus}
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!isOnline ? (
              <button
                className="sh-btn-primary"
                style={{ flex: 1 }}
                onClick={handleConnect}
                disabled={!simTopic.trim() || simStatus === 'connecting'}
              >
                Connect
              </button>
            ) : (
              <>
                <button className="sh-btn-ghost" style={{ flex: 1 }} onClick={handleDisconnect}>
                  Disconnect
                </button>
                <button
                  className="sh-card-remove"
                  style={{ flex: 1 }}
                  onClick={handlePowerLoss}
                  title="จำลองไฟดับ — broker ส่ง Will Message แทน"
                >
                  Power Loss
                </button>
              </>
            )}
          </div>

          {/* Log */}
          <div style={{
            background: 'var(--surface-raised, oklch(0.12 0 0))',
            borderRadius: 6,
            padding: '8px 10px',
            minHeight: 120,
            maxHeight: 200,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--ink-dim)',
            lineHeight: 1.6,
          }}>
            {logs.length === 0
              ? <span style={{ color: 'var(--ink-xdim)' }}>log จะแสดงที่นี่หลัง connect...</span>
              : logs.map((l, i) => <div key={i}>{l}</div>)
            }
            <div ref={logsEndRef} />
          </div>
        </div>
      </motion.div>
    </div>
  )
}
