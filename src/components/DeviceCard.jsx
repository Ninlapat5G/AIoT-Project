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
  if (TOPIC_RE.test(t)) return 'ห้ามใช้ # หรือ + ใน publish topic'
  return null
}

// ── Edit: Digital / Analog device ─────────────────────────────────────────────

const EditCard = memo(function EditCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)
  const set = patch => setDraft(d => ({ ...d, ...patch }))

  const pubErr = topicError(draft.pubTopic)
  const hasErr = !!pubErr

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
        <div className="sh-field">
          <span className="mono flex justify-between">
            MQTT TOPIC SUFFIX
            <span style={{ color: 'var(--ink-xdim)' }}>OPTIONAL</span>
          </span>
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center gap-2">
              <span className="sh-topic-tag mono">PUB</span>
              <input
                value={draft.pubTopic || ''}
                onChange={e => set({ pubTopic: e.target.value })}
                placeholder={`${draft.room.toLowerCase().replace(/\s+/g, '-')}/${draft.id}/set`}
                style={pubErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
              />
            </div>
            {pubErr && (
              <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)', paddingLeft: 40 }}>
                ⚠ {pubErr}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="sh-topic-tag sub mono">SUB</span>
              <input
                value={draft.subTopic || ''}
                onChange={e => set({ subTopic: e.target.value })}
                placeholder={`${draft.room.toLowerCase().replace(/\s+/g, '-')}/${draft.id}/state`}
              />
            </div>
          </div>
        </div>
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

  const pubErr = topicError(draft.pubTopic)

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
        <div className="sh-field">
          <span className="mono">PUB TOPIC</span>
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center gap-2">
              <span className="sh-topic-tag mono">PUB</span>
              <input
                value={draft.pubTopic || ''}
                onChange={e => set({ pubTopic: e.target.value })}
                style={pubErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
              />
            </div>
            {pubErr && (
              <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)', paddingLeft: 40 }}>
                ⚠ {pubErr}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="sh-card-edit-foot">
        <button className="sh-card-remove" onClick={() => onRemove(device.id)}>Remove</button>
        <div className="flex-1" />
        <button className="sh-btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="sh-btn-primary"
          disabled={!!pubErr}
          onClick={() => { if (!pubErr) { onUpdate(draft); onCancel() } }}
        >
          Save
        </button>
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
    onRawPublish?.(device.pubTopic, c)
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

      {device.pubTopic && (
        <div className="sh-card-topics">
          <span className="sh-card-topic-chip" title={device.pubTopic}>
            <b>PUB</b>{device.pubTopic}
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
    return device.type === 'os_terminal'
      ? <EditTerminalCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />
      : <EditCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />
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

      {(device.pubTopic || device.subTopic) && (
        <div className="sh-card-topics">
          {device.pubTopic && (
            <span className="sh-card-topic-chip" title={device.pubTopic}>
              <b>PUB</b>{device.pubTopic}
            </span>
          )}
          {device.subTopic && (
            <span className="sh-card-topic-chip sub" title={device.subTopic}>
              <b>SUB</b>{device.subTopic}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
})

export default DeviceCard

// ── Add Device tile ────────────────────────────────────────────────────────────

export function AddDeviceTile({ onClick }) {
  return (
    <motion.button
      className="sh-card sh-add"
      onClick={onClick}
      variants={cardVariants}
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-add-inner">
        <div className="sh-add-plus"><Icon name="plus" size={22} /></div>
        <div className="sh-add-label">Add Device</div>
        <div className="sh-add-sub mono">PAIR · MQTT · ZIGBEE</div>
      </div>
    </motion.button>
  )
}

// ── Add Terminal tile (with setup form) ───────────────────────────────────────

export function AddTerminalTile({ onCreate, defaultArea }) {
  const [forming, setForming] = useState(false)
  const [name, setName] = useState('')
  const [os, setOs] = useState('windows')
  const [pubTopic, setPubTopic] = useState('')

  useEffect(() => {
    if (name.trim()) {
      const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
      setPubTopic(`${slug}/cmd`)
    } else {
      setPubTopic('')
    }
  }, [name])

  const reset = () => { setForming(false); setName(''); setOs('windows'); setPubTopic('') }

  const save = () => {
    const trimName = name.trim()
    const trimTopic = pubTopic.trim()
    if (!trimName || !trimTopic || topicError(trimTopic)) return
    const id = 'term-' + Date.now().toString(36)
    const slug = trimName.toLowerCase().replace(/\s+/g, '-')
    onCreate({
      id,
      name: trimName,
      room: defaultArea || 'Living Room',
      type: 'os_terminal',
      os,
      icon: 'terminal',
      pubTopic: trimTopic,
      subTopic: `${slug}/output`,
    })
    reset()
  }

  const pubErr = topicError(pubTopic)

  if (forming) {
    return (
      <motion.div
        className="sh-card sh-card-editing"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
      >
        <div className="sh-card-edit-head">
          <span className="sh-card-edit-eye mono">NEW TERMINAL</span>
          <button className="sh-card-gear" style={{ opacity: 1 }} onClick={reset}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="sh-card-edit-body">
          <label className="sh-field">
            <span className="mono">COMPUTER NAME</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="office-pc"
              autoFocus
            />
          </label>
          <label className="sh-field">
            <span className="mono">OS</span>
            <div className="sh-seg flex">
              {['windows', 'mac', 'linux'].map(o => (
                <button
                  key={o} type="button"
                  className={os === o ? 'on' : ''}
                  onClick={() => setOs(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </label>
          <div className="sh-field">
            <span className="mono">PUB TOPIC</span>
            <div className="flex flex-col gap-1.5 mt-1">
              <div className="flex items-center gap-2">
                <span className="sh-topic-tag mono">PUB</span>
                <input
                  value={pubTopic}
                  onChange={e => setPubTopic(e.target.value)}
                  placeholder="office-pc/cmd"
                  style={pubErr ? { borderColor: 'oklch(0.65 0.22 25)' } : {}}
                />
              </div>
              {pubErr && (
                <span className="mono" style={{ fontSize: 10, color: 'oklch(0.72 0.22 25)', paddingLeft: 40 }}>
                  ⚠ {pubErr}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="sh-card-edit-foot">
          <div className="flex-1" />
          <button className="sh-btn-ghost" onClick={reset}>Cancel</button>
          <button
            className="sh-btn-primary"
            disabled={!name.trim() || !pubTopic.trim() || !!pubErr}
            onClick={save}
          >
            Add
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.button
      className="sh-card sh-add"
      onClick={() => setForming(true)}
      variants={cardVariants}
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-add-inner">
        <div className="sh-add-plus"><Icon name="terminal" size={22} /></div>
        <div className="sh-add-label">Add Terminal</div>
        <div className="sh-add-sub mono">CMD · BASH · MQTT</div>
      </div>
    </motion.button>
  )
}
