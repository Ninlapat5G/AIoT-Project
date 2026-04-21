import { useState, useEffect } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import Icon from './ui/Icon'
import Toggle from './ui/Toggle'
import Slider from './ui/Slider'

function AnimatedReadout({ value }) {
  const mv      = useMotionValue(value)
  const [num, setNum] = useState(value)

  useEffect(() => {
    const ctrl = animate(mv, value, {
      duration: 0.45,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: v => setNum(Math.round(v)),
    })
    return () => ctrl.stop()
  }, [value, mv])

  return (
    <div className="sh-card-readout">
      <span className="sh-card-val mono">{String(num).padStart(3, '0')}</span>
      <span className="sh-card-unit mono">/ 255 · {Math.round((num / 255) * 100)}%</span>
    </div>
  )
}

export const cardVariants = {
  hidden:  { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0,  scale: 1 },
}

function EditCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)

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
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="sh-field">
          <span className="mono">AREA</span>
          <select value={draft.room} onChange={e => setDraft({ ...draft, room: e.target.value })}>
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
                  setDraft({
                    ...draft,
                    type: t,
                    ...(t === 'analog' ? { value: draft.value ?? 128 } : { on: draft.on ?? false }),
                  })
                }
              >
                {t}
              </button>
            ))}
          </div>
        </label>
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
                onChange={e => setDraft({ ...draft, pubTopic: e.target.value })}
                placeholder={`${draft.room.toLowerCase().replace(/\s+/g, '-')}/${draft.id}/set`}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="sh-topic-tag sub mono">SUB</span>
              <input
                value={draft.subTopic || ''}
                onChange={e => setDraft({ ...draft, subTopic: e.target.value })}
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
          onClick={() => { onUpdate(draft); onCancel() }}
        >
          Save
        </button>
      </div>
    </motion.div>
  )
}

export default function DeviceCard({ device, onUpdate, onRemove, areas }) {
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) return }, [editing])

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
          <AnimatedReadout value={device.value} />
          <Slider
            value={device.value}
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
}

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
