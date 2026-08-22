import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { generatePin, pinToHex, encryptCfg, decryptCfg } from '../utils/cfgShare'
import { normalizeBase, buildFullTopic } from '../utils/mqttTopic'
import { loadDevices, loadAreas, saveDevices, saveAreas } from '../utils/storage'
import Icon from './ui/Icon'

const TTL = 300

const cardAnim = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
  transition: { duration: 0.18 },
}

function SuccessCard({ title, sub }) {
  return (
    <motion.div
      className="sh-share-success"
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', damping: 14, stiffness: 220 }}
    >
      <motion.div
        className="sh-success-ring"
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 11, stiffness: 260, delay: 0.05 }}
      >
        <svg viewBox="0 0 40 40" fill="none" width="40" height="40">
          <motion.path
            d="M10 21l7 7 13-14"
            stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.25, duration: 0.35, ease: 'easeOut' }}
          />
        </svg>
      </motion.div>
      <motion.div
        style={{ textAlign: 'center' }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="sh-success-title">{title}</div>
        <div className="sh-success-sub">{sub}</div>
      </motion.div>
    </motion.div>
  )
}

export default function CfgSharePanel({ settings, onSave, mqttPublish, mqttWaitForMessage, sensorCache, setDevices, setAreas }) {
  const [mode, setMode]   = useState('idle')
  const [pin,  setPin]    = useState('')
  const [secs, setSecs]   = useState(TTL)
  const [chars, setChars] = useState(['', '', '', '', '', ''])
  const [err,  setErr]    = useState('')

  const timerRef     = useRef(null)
  const hexRef       = useRef('')
  const abortRef     = useRef(false)
  const inputRefs    = useRef([])
  const doCancelRef  = useRef(null)

  useEffect(() => () => { clearInterval(timerRef.current); abortRef.current = true }, [])

  const cfgRel = hex => `__cfg__/${hex}`
  const ackRel = hex => `__cfg__/${hex}/ack`
  const full   = rel  => {
    const base = normalizeBase(settings.mqtt?.baseTopic)
    return buildFullTopic(rel, base)
  }
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  // ── Sender ──────────────────────────────────────────────────────────────────
  const startSend = async () => {
    const p   = generatePin()
    const hex = await pinToHex(p)
    hexRef.current  = hex
    abortRef.current = false

    const payload   = { settings, devices: loadDevices() || [], areas: loadAreas() || [] }
    const encrypted = await encryptCfg(payload, p)
    mqttPublish(cfgRel(hex), encrypted, {
      qos: 1, retain: true,
      properties: {
        messageExpiryInterval: TTL,
        responseTopic: full(ackRel(hex)),
      },
    })

    setPin(p)
    setSecs(TTL)
    setMode('sending')

    timerRef.current = setInterval(() =>
      setSecs(s => { if (s <= 1) { doCancelRef.current?.(hex); return 0 } return s - 1 }), 1000)

    const ackResult = await mqttWaitForMessage(full(ackRel(hex)), TTL * 1000)
    if (abortRef.current) return
    clearInterval(timerRef.current)
    mqttPublish(cfgRel(hex), '', { qos: 1, retain: true })
    if (ackResult?.value) {
      setMode('success')
      setTimeout(() => { if (!abortRef.current) setMode('idle') }, 3000)
    } else {
      setErr('หมดเวลา — ไม่ได้รับการยืนยันจากอุปกรณ์ปลายทาง')
      setTimeout(() => { if (!abortRef.current) { setMode('idle'); setErr('') } }, 3000)
    }
  }

  const doCancel = useCallback((hexOverride) => {
    abortRef.current = true
    clearInterval(timerRef.current)
    const hex = hexOverride || hexRef.current
    if (hex) mqttPublish(cfgRel(hex), '', { qos: 1, retain: true })
    setMode('idle')
    setPin('')
    setSecs(TTL)
  }, [mqttPublish])

  useEffect(() => { doCancelRef.current = doCancel }, [doCancel])

  // ── Receiver ────────────────────────────────────────────────────────────────
  const handleChar = (i, val) => {
    const ch   = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1)
    const next = [...chars]
    next[i]    = ch
    setChars(next)
    if (ch && i < 5) inputRefs.current[i + 1]?.focus()
    if (next.every(c => c)) doImport(next.join(''))
  }

  const handleKey = (i, e) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      const next = [...chars]; next[i - 1] = ''
      setChars(next); inputRefs.current[i - 1]?.focus()
    }
  }

  const doImport = async p => {
    setErr('')
    setMode('importing')
    abortRef.current = false
    try {
      const hex      = await pinToHex(p)
      const cfgFull  = full(cfgRel(hex))
      let encrypted = sensorCache?.[cfgFull]
      let ackTarget = full(ackRel(hex))

      if (!encrypted) {
        const result = await mqttWaitForMessage(cfgFull, 10_000)
        encrypted = result?.value
        // ถ้า sender ใส่ responseTopic มาใน MQTT 5 properties ให้ใช้ตามนั้น
        ackTarget = result?.packet?.properties?.responseTopic ?? ackTarget
      }

      if (!encrypted) throw new Error('ไม่พบ config — ตรวจสอบ PIN หรือลองใหม่')

      const data = await decryptCfg(encrypted, p)
      // เขียนทั้ง localStorage และ React state — เขียนแค่ localStorage เฉยๆ
      // จะโดน useDevices/useAreas เขียนทับด้วยค่าเดิมทันทีที่ state เปลี่ยนครั้งถัดไป
      if (data.settings) onSave(data.settings)
      if (data.devices)  { saveDevices(data.devices); setDevices?.(data.devices) }
      if (data.areas)    { saveAreas(data.areas);     setAreas?.(data.areas) }

      mqttPublish(ackTarget, 'ok', { qos: 1 })
      setMode('imported')
      setTimeout(() => { if (!abortRef.current) { setMode('idle'); setChars(['', '', '', '', '', '']) } }, 3000)
    } catch (e) {
      setErr(e.message || 'เกิดข้อผิดพลาด')
      setMode('receiving')
      setChars(['', '', '', '', '', ''])
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    }
  }

  const openReceiver = () => {
    setChars(['', '', '', '', '', ''])
    setErr('')
    setMode('receiving')
    setTimeout(() => inputRefs.current[0]?.focus(), 80)
  }

  const closeReceiver = () => {
    setMode('idle')
    setChars(['', '', '', '', '', ''])
    setErr('')
  }

  const disabled = !mqttPublish

  return (
    <div className="sh-share-panel">
      <AnimatePresence mode="wait">

        {mode === 'idle' && (
          <motion.div key="idle" className="sh-grid2" {...cardAnim}>
            <div className="sh-field">
              <label className="mono" style={{ marginBottom: 4 }}>ส่งแบบไร้สาย</label>
              <button className="sh-btn-ghost w-full" style={{ justifyContent: 'center', height: 40 }}
                onClick={startSend} disabled={disabled}>
                <Icon name="send" size={14} /> ส่ง PIN ไปอุปกรณ์อื่น
              </button>
            </div>
            <div className="sh-field">
              <label className="mono" style={{ marginBottom: 4 }}>รับการตั้งค่า</label>
              <button className="sh-btn-ghost w-full" style={{ justifyContent: 'center', height: 40 }}
                onClick={openReceiver} disabled={disabled}>
                <Icon name="download" size={14} /> กรอก PIN
              </button>
            </div>
          </motion.div>
        )}

        {mode === 'sending' && (
          <motion.div key="sending" className="sh-share-card" {...cardAnim}>
            <div className="sh-share-label mono">PIN สำหรับอุปกรณ์ปลายทาง</div>
            <div className="sh-pin-row">
              {pin.split('').map((c, i) => (
                <motion.div key={i} className="sh-pin-box"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, type: 'spring', damping: 14, stiffness: 260 }}
                >
                  {c}
                </motion.div>
              ))}
            </div>
            <div className="sh-pin-timer">
              <motion.div className="sh-pin-bar"
                initial={{ scaleX: 1 }} animate={{ scaleX: 0 }}
                transition={{ duration: TTL, ease: 'linear' }}
              />
              <span className="mono">{fmt(secs)} เหลืออยู่ · รอการยืนยันจากอุปกรณ์ปลายทาง</span>
            </div>
            {err && (
              <motion.div className="sh-pin-error mono"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                {err}
              </motion.div>
            )}
            <button className="sh-btn-dim" onClick={() => doCancel()}>
              <Icon name="close" size={12} /> ยกเลิก
            </button>
          </motion.div>
        )}

        {mode === 'success' && (
          <SuccessCard key="success" title="ส่งสำเร็จ!" sub="อุปกรณ์ปลายทางได้รับการตั้งค่าแล้ว" />
        )}

        {(mode === 'receiving' || mode === 'importing') && (
          <motion.div key="receiving" className="sh-share-card" {...cardAnim}>
            <div className="sh-share-label mono">กรอก PIN จากอุปกรณ์ต้นทาง</div>
            <div className="sh-pin-row">
              {chars.map((c, i) => (
                <input key={i}
                  ref={el => { inputRefs.current[i] = el }}
                  className="sh-pin-input"
                  maxLength={2}
                  value={c}
                  onChange={e => handleChar(i, e.target.value)}
                  onKeyDown={e => handleKey(i, e)}
                  disabled={mode === 'importing'}
                />
              ))}
            </div>
            {err && (
              <motion.div className="sh-pin-error mono"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                {err}
              </motion.div>
            )}
            {mode === 'importing' && (
              <div className="sh-pin-loading mono">กำลังรับและถอดรหัส...</div>
            )}
            <button className="sh-btn-dim" onClick={closeReceiver}>
              <Icon name="close" size={12} /> ยกเลิก
            </button>
          </motion.div>
        )}

        {mode === 'imported' && (
          <SuccessCard key="imported" title="นำเข้าสำเร็จ!" sub="การตั้งค่าถูกโหลดแล้ว — แอปจะอัปเดตทันที" />
        )}

      </AnimatePresence>
    </div>
  )
}
