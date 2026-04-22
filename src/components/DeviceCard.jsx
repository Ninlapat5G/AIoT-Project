import { useState, useEffect, memo } from 'react'
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
                onClick={() => set(
                  t === 'analog'
                    ? { type: t, value: draft.value ?? 128, max: draft.max ?? 255 }
                    : { type: t, on: draft.on ?? false },
                )}
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

const DeviceCard = memo(function DeviceCard({ device, onUpdate, onRemove, areas }) {
  const [editing, setEditing] = useState(false)
  const max = device.max ?? 255
  const isOn = device.type === 'digital' ? device.on : device.value > 0

  if (editing) {
    return (
      <EditCard
        device={device}
        onUpdate={onUpdate}
        onRemove={onRemove}
        areas={areas}
        onCancel={() => setEditing(false)}
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