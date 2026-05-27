import { useState, useEffect, useRef, memo } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import Icon from './ui/Icon'
import Toggle from './ui/Toggle'
import Slider from './ui/Slider'

function AnimatedReadout({ value, max = 255 }) {
  const mv = useMotionValue(value)
  const [num, setNum] = useState(value)

  useEffect(() => {
    const ctrl = animate(mv, value, {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: v => setNum(Math.round(v)),
    })
    return () => ctrl.stop()
  }, [value, mv])

  const pad = max > 255 ? 4 : 3

  return (
    <div className="sh-card-readout">
      <span className="sh-card-val mono">{String(num).padStart(pad, '0')}</span>
      <span className="sh-card-unit mono">/ {max} · {Math.round((num / max) * 100)}%</span>
    </div>
  )
}

export const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
}

const MAX_OPTIONS = [255, 1023]
const TOPIC_RE = /[#+]/

function topicError(t) {
  if (!t) return null
  if (TOPIC_RE.test(t)) return 'ห้ามใช้ # หรือ + ใน topic'
  return null
}

function pinError(p) {
  if (p === '' || p == null) return null
  const n = Number(p)
  if (!Number.isInteger(n) || n < 0 || n > 48) return 'pin ต้องเป็น 0–48'
  return null
}

// ── Edit: Digital / Analog device ─────────────────────────────────────────────

const EditCard = memo(function EditCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)
  const set = patch => setDraft(d => ({ ...d, ...patch }))

  const topicErr = topicError(draft.topic)
  const pErr     = pinError(draft.pin)
  const hasErr   = !!(topicErr || pErr)

  return (
    <motion.div
      className="sh-card sh-card-editing"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
    >
      <div className="sh-card-edit-head">
        <span className="sh-card-edit-eye mono">EDIT DEVICE</span>
        <button className="sh-card-gear" style={{ opacity: 1 }} onClick={onCancel}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="sh-card-edit-body">
        <label className="sh-field">
          <span className="mono">NAME</span>
          <input value={draft.name} onChange={e => set({ name: e.target.value })} />
        </label>
        <label className="sh-field">
          <span className="mono">AREA</span>
          <select value={draft.room} onChange={e => set({ room: e.target.value })}>
            {[...new Set([draft.room, ...(areas || [])])].map(a => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="sh-field">
          <span className="mono">TYPE</span>
          <div className="sh-seg flex">
            {['digital', 'analog'].map(t => (
              <button
                key={t} type="button"
                className={draft.type === t ? 'on' : ''}
                onClick={() =>
                  t === 'analog'
                    ? set({ type: t, value: draft.value ?? 128, max: draft.max ?? 255 })
                    : set({ type: t, on: draft.on ?? false })
                }
              >
                {t}
              </button>
            ))}
          </div>
        </label>
        {draft.type === 'analog' && (
          <label className="sh-field">
            <span className="mono">MAX VALUE</span>
            <div className="sh-seg flex">
              {MAX_OPTIONS.map(m => (
                <button
                  key={m} type="button"
                  className={(draft.max ?? 255) === m ? 'on' : ''}
                  onClick={() => set({ max: m, value: Math.min(draft.value ?? 0, m) })}
                >
                  {m}
                </button>
              ))}
            </div>
          </label>
        )}
        {/* MQTT topic — field เดียว, /set และ /state derive อัตโนมัติ */}
        <label className="sh-field">
          <span className="mono flex justify-between">
            MQTT TOPIC
            <span style={{ color: 'var(--ink-xdim)' }}>OPTIONAL</span>
          </span>
          <input
            value={draft.topic || ''}
            onChange={e => set({ topic: e.target.value })}
            placeholder={`${draft.room.toLowerCase().replace(/\s+/g, '-')}/${draft.id}`}
            style={topicErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
          />
          {topicErr && (
            <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)' }}>
              ⚠ {topicErr}
            </span>
          )}
        </label>
        {/* Pin — ส่ง config ไปบอร์ดผ่าน /config ตอน save */}
        <label className="sh-field">
          <span className="mono flex justify-between">
            PIN
            <span style={{ color: 'var(--ink-xdim)' }}>GPIO 0–48</span>
          </span>
          <input
            type="number"
            min="0" max="48"
            value={draft.pin ?? ''}
            onChange={e => set({ pin: e.target.value === '' ? '' : Number(e.target.value) })}
            placeholder="ไม่ระบุ"
            style={pErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
          />
          {pErr && (
            <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)' }}>
              ⚠ {pErr}
            </span>
          )}
        </label>
      </div>
      <div className="sh-card-edit-foot">
        <button className="sh-card-remove" onClick={() => onRemove(device.id)}>Remove</button>
        <div className="flex-1" />
        <button className="sh-btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="sh-btn-primary"
          disabled={hasErr}
          onClick={() => { if (!hasErr) { onUpdate(draft); onCancel() } }}
        >
          Save
        </button>
      </div>
    </motion.div>
  )
})

// ── Edit: Terminal device ──────────────────────────────────────────────────────

function EditTerminalCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)
  const set = patch => setDraft(d => ({ ...d, ...patch }))

  const topicErr = topicError(draft.topic)

  return (
    <motion.div
      className="sh-card sh-card-editing"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
    >
      <div className="sh-card-edit-head">
        <span className="sh-card-edit-eye mono">EDIT TERMINAL</span>
        <button className="sh-card-gear" style={{ opacity: 1 }} onClick={onCancel}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="sh-card-edit-body">
        <label className="sh-field">
          <span className="mono">NAME</span>
          <input value={draft.name} onChange={e => set({ name: e.target.value })} />
        </label>
        <label className="sh-field">
          <span className="mono">AREA</span>
          <select value={draft.room} onChange={e => set({ room: e.target.value })}>
            {[...new Set([draft.room, ...(areas || [])])].map(a => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="sh-field">
          <span className="mono">OS</span>
          <div className="sh-seg flex">
            {['windows', 'mac', 'linux'].map(os => (
              <button
                key={os} type="button"
                className={draft.os === os ? 'on' : ''}
                onClick={() => set({ os })}
              >
                {os}
              </button>
            ))}
          </div>
        </label>
        <label className="sh-field">
          <span className="mono">MQTT TOPIC</span>
          <input
            value={draft.topic || ''}
            onChange={e => set({ topic: e.target.value })}
            style={topicErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
          />
          {topicErr && (
            <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)' }}>
              ⚠ {topicErr}
            </span>
          )}
        </label>
      </div>
      <div className="sh-card-edit-foot">
        <button className="sh-card-remove" onClick={() => onRemove(device.id)}>Remove</button>
        <div className="flex-1" />
        <button className="sh-btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="sh-btn-primary"
          disabled={!!topicErr}
          onClick={() => { if (!topicErr) { onUpdate(draft); onCancel() } }}
        >
          Save
        </button>
      </div>
    </motion.div>
  )
}

// ── Edit: Hub device ──────────────────────────────────────────────────────────

function EditHubCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)
  const set = patch => setDraft(d => ({ ...d, ...patch }))

  const topicErr = topicError(draft.topic)

  return (
    <motion.div
      className="sh-card sh-card-editing"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
    >
      <div className="sh-card-edit-head">
        <span className="sh-card-edit-eye mono">EDIT HUB</span>
        <button className="sh-card-gear" style={{ opacity: 1 }} onClick={onCancel}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="sh-card-edit-body">
        <label className="sh-field">
          <span className="mono">NAME</span>
          <input value={draft.name} onChange={e => set({ name: e.target.value })} />
        </label>
        <label className="sh-field">
          <span className="mono">AREA</span>
          <select value={draft.room} onChange={e => set({ room: e.target.value })}>
            {[...new Set([draft.room, ...(areas || [])])].map(a => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {/* agentName auto-populate topic */}
        <label className="sh-field">
          <span className="mono">AGENT NAME</span>
          <input
            value={draft.agentName || ''}
            onChange={e => {
              const a = e.target.value
              set({
                agentName: a,
                topic: a.trim() ? `hub/${a.trim()}` : draft.topic,
              })
            }}
            placeholder="office-pc"
            className="mono"
          />
        </label>
        <label className="sh-field">
          <span className="mono">MQTT TOPIC</span>
          <input
            value={draft.topic || ''}
            onChange={e => set({ topic: e.target.value })}
            placeholder="hub/office-pc"
            style={topicErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
          />
          {topicErr && (
            <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)' }}>
              ⚠ {topicErr}
            </span>
          )}
        </label>
      </div>
      <div className="sh-card-edit-foot">
        <button className="sh-card-remove" onClick={() => onRemove(device.id)}>Remove</button>
        <div className="flex-1" />
        <button className="sh-btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="sh-btn-primary"
          disabled={!!topicErr}
          onClick={() => { if (!topicErr) { onUpdate(draft); onCancel() } }}
        >
          Save
        </button>
      </div>
    </motion.div>
  )
}

// ── Hub widget ─────────────────────────────────────────────────────────────────

function HubCard({ device, onEdit }) {
  return (
    <motion.div
      className="sh-card"
      variants={cardVariants}
      whileHover={{ y: -2, boxShadow: '0 8px 32px oklch(0 0 0 / 0.18)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-card-top">
        <div className="sh-card-icon">
          <Icon name="sparkle" size={20} />
          <span className="sh-card-status-dot" style={{ background: 'var(--accent)' }} />
        </div>
        <div className="sh-card-meta">
          <div className="sh-card-room mono">{device.room.toUpperCase()}</div>
          <div className="sh-card-name">{device.name}</div>
        </div>
        <div className="sh-card-actions">
          <button className="sh-card-gear" onClick={onEdit} title="Edit">
            <Icon name="gear" size={13} />
          </button>
        </div>
      </div>
      <div className="sh-card-topics">
        <span className="sh-card-topic-chip mono" style={{ color: 'var(--accent)' }}>
          <b>HUB</b>{device.agentName || device.name}
        </span>
        {device.topic && (
          <span className="sh-card-topic-chip" title={device.topic + '/cmd'}>
            <b>CMD</b>{device.topic}/cmd
          </span>
        )}
        {device.topic && (
          <span className="sh-card-topic-chip sub" title={device.topic + '/output'}>
            <b>OUT</b>{device.topic}/output
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ── Terminal widget ────────────────────────────────────────────────────────────

function OsTerminalCard({ device, onRawPublish, onEdit, onRemove }) {
  const [cmd, setCmd] = useState('')
  const [lastCmd, setLastCmd] = useState(null)
  const inputRef = useRef(null)

  const send = () => {
    const c = cmd.trim()
    if (!c) return
    onRawPublish?.(device.topic, c)
    setLastCmd(c)
    setCmd('')
    inputRef.current?.focus()
  }

  return (
    <motion.div
      className="sh-card"
      variants={cardVariants}
      whileHover={{ y: -2, boxShadow: '0 8px 32px oklch(0 0 0 / 0.18)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-card-top">
        <div className="sh-card-icon">
          <Icon name="terminal" size={20} />
          <span className="sh-card-status-dot" />
        </div>
        <div className="sh-card-meta">
          <div className="sh-card-room mono">{device.room.toUpperCase()}</div>
          <div className="sh-card-name">{device.name}</div>
        </div>
        <div className="sh-card-actions">
          <button className="sh-card-gear" onClick={onEdit} title="Edit">
            <Icon name="gear" size={13} />
          </button>
        </div>
      </div>

      <div className="sh-card-body" style={{ padding: '8px 12px 12px' }}>
        {lastCmd && (
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={lastCmd}
          >
            $ {lastCmd}
          </div>
        )}
        <form
          onSubmit={e => { e.preventDefault(); send() }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}
        >
          <span className="mono" style={{ fontSize: 14, color: 'var(--accent)', flexShrink: 0, lineHeight: 1 }}>$</span>
          <input
            ref={inputRef}
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            placeholder="raw command…"
            className="mono"
            style={{ flex: 1, fontSize: 13, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink)', padding: '2px 0' }}
          />
          <button
            type="submit"
            disabled={!cmd.trim()}
            className="sh-icon-btn"
            title="Send"
          >
            <Icon name="send" size={13} />
          </button>
        </form>
      </div>

      {device.topic && (
        <div className="sh-card-topics">
          <span className="sh-card-topic-chip" title={device.topic}>
            <b>PUB</b>{device.topic}
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ── Device card (digital / analog) ────────────────────────────────────────────

const DeviceCard = memo(function DeviceCard({ device, onUpdate, onRemove, areas, onRawPublish }) {
  const [editing, setEditing] = useState(false)
  const max = device.max ?? 255
  const isOn = device.type === 'digital' ? device.on : device.value > 0

  if (editing) {
    if (device.type === 'os_terminal')
      return <EditTerminalCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />
    if (device.type === 'hub')
      return <EditHubCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />
    return <EditCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />
  }

  if (device.type === 'os_terminal') {
    return (
      <OsTerminalCard
        device={device}
        onRawPublish={onRawPublish}
        onEdit={() => setEditing(true)}
        onRemove={onRemove}
      />
    )
  }

  if (device.type === 'hub') {
    return <HubCard device={device} onEdit={() => setEditing(true)} />
  }

  return (
    <motion.div
      className={`sh-card ${isOn ? 'is-on' : ''}`}
      variants={cardVariants}
      whileHover={{ y: -2, boxShadow: '0 8px 32px oklch(0 0 0 / 0.18)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-card-top">
        <div className="sh-card-icon">
          <Icon name={device.icon} size={20} />
          <span className="sh-card-status-dot" />
        </div>
        <div className="sh-card-meta">
          <div className="sh-card-room mono">{device.room.toUpperCase()}</div>
          <div className="sh-card-name">{device.name}</div>
        </div>
        <div className="sh-card-actions">
          <button className="sh-card-gear" onClick={() => setEditing(true)} title="Edit">
            <Icon name="gear" size={13} />
          </button>
          {device.type === 'digital' && (
            <Toggle on={device.on} onChange={v => onUpdate({ ...device, on: v })} />
          )}
        </div>
      </div>

      {device.type === 'analog' ? (
        <div className="sh-card-body">
          <AnimatedReadout value={device.value} max={max} />
          <Slider
            value={device.value}
            max={max}
            onChange={(v, isFinal) => onUpdate({ ...device, value: v }, isFinal)}
          />
        </div>
      ) : (
        <div className="sh-card-body digital">
          <div className="sh-card-state">
            <span className={`sh-state-pill ${device.on ? 'on' : ''}`}>
              <i />
              {device.on ? 'ACTIVE' : 'STANDBY'}
            </span>
            <span className="sh-card-id mono">#{device.id}</span>
          </div>
        </div>
      )}

      {device.topic && (
        <div className="sh-card-topics">
          <span className="sh-card-topic-chip" title={device.topic + '/set'}>
            <b>SET</b>{device.topic}/set
          </span>
          <span className="sh-card-topic-chip sub" title={device.topic + '/state'}>
            <b>STATE</b>{device.topic}/state
          </span>
        </div>
      )}
    </motion.div>
  )
})

export default DeviceCard

// ── Add tile (รวม Device + Hub + Simulate) ────────────────────────────────────

export function AddTile({ devTools, onCreateDevice, onCreateHub, onSimulate }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const options = [
    { key: 'device',   label: '💡 Device',   sub: 'MQTT · ZIGBEE' },
    { key: 'hub',      label: '🖥 Hub',       sub: 'AI · MQTT' },
    ...(devTools ? [{ key: 'simulate', label: '⚡ Simulate', sub: 'ESP32 mock' }] : []),
  ]

  const toggle = key => setSelected(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const confirm = () => {
    if (selected.has('device'))   onCreateDevice?.()
    if (selected.has('hub'))      onCreateHub?.()
    if (selected.has('simulate')) onSimulate?.()
    setOpen(false)
    setSelected(new Set())
  }

  const cancel = () => { setOpen(false); setSelected(new Set()) }

  if (open) {
    return (
      <motion.div
        className="sh-card sh-add"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        style={{ cursor: 'default', justifyContent: 'flex-start', padding: '14px 16px', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span className="sh-card-edit-eye mono">ADD NEW</span>
          <button className="sh-card-gear" style={{ opacity: 1 }} onClick={cancel}>
            <Icon name="close" size={13} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {options.map(opt => (
            <label
              key={opt.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}
            >
              <input
                type="checkbox"
                checked={selected.has(opt.key)}
                onChange={() => toggle(opt.key)}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, marginRight: 6 }}>{opt.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-xdim)' }}>{opt.sub}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 4 }}>
          <button className="sh-btn-ghost" style={{ flex: 1 }} onClick={cancel}>Cancel</button>
          <button
            className="sh-btn-primary"
            style={{ flex: 1 }}
            disabled={selected.size === 0}
            onClick={confirm}
          >
            Add Selected
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.button
      className="sh-card sh-add"
      onClick={() => setOpen(true)}
      variants={cardVariants}
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-add-inner">
        <div className="sh-add-plus"><Icon name="plus" size={22} /></div>
        <div className="sh-add-label">Add New</div>
        <div className="sh-add-sub mono">DEVICE · HUB{devTools ? ' · SIM' : ''}</div>
      </div>
    </motion.button>
  )
}
