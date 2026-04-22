import { useState, useEffect, memo } from 'react'
import { motion, useMotionValue, animate } from 'framer-motion'
import Icon from './ui/Icon'
import Toggle from './ui/Toggle'
import Slider from './ui/Slider'

function AnimatedReadout({ value, max = 255 }) {
  const mv = useMotionValue(value)
  const [num, setNum] = useState(value)
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 0.45, ease: [0.16, 1, 0.3, 1], onUpdate: v => setNum(Math.round(v)) })
    return () => ctrl.stop()
  }, [value, mv])
  return (
    <div className="sh-card-readout">
      <span className="sh-card-val mono">{String(num).padStart(max > 255 ? 4 : 3, '0')}</span>
      <span className="sh-card-unit mono">/ {max}</span>
    </div>
  )
}

export const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
}

const EditCard = memo(function EditCard({ device, onUpdate, onRemove, areas, onCancel }) {
  const [draft, setDraft] = useState(device)
  return (
    <motion.div className="sh-card sh-card-editing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="sh-card-edit-body">
        <label className="sh-field"><span className="mono">NAME</span><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="sh-field"><span className="mono">AREA</span><select value={draft.room} onChange={e => setDraft({ ...draft, room: e.target.value })}>{areas.map(a => <option key={a}>{a}</option>)}</select></label>
      </div>
      <div className="sh-card-edit-foot">
        <button onClick={() => onRemove(device.id)}>Remove</button>
        <button onClick={onCancel}>Cancel</button>
        <button className="sh-btn-primary" onClick={() => { onUpdate(draft); onCancel() }}>Save</button>
      </div>
    </motion.div>
  )
})

const DeviceCard = memo(function DeviceCard({ device, onUpdate, onRemove, areas }) {
  const [editing, setEditing] = useState(false)
  const max = device.max ?? 255
  const isOn = device.type === 'digital' ? device.on : device.value > 0

  if (editing) return <EditCard device={device} onUpdate={onUpdate} onRemove={onRemove} areas={areas} onCancel={() => setEditing(false)} />

  return (
    <motion.div
      className={`sh-card ${isOn ? 'is-on' : ''}`}
      variants={cardVariants}
      whileHover={{ y: -2, boxShadow: '0 8px 32px oklch(0 0 0 / 0.18)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-card-top">
        <div className="sh-card-icon"><Icon name={device.icon} size={20} /><span className="sh-card-status-dot" /></div>
        <div className="sh-card-meta"><div className="sh-card-room mono">{device.room.toUpperCase()}</div><div className="sh-card-name">{device.name}</div></div>
        <div className="sh-card-actions">
          <button onClick={() => setEditing(true)}><Icon name="gear" size={13} /></button>
          {device.type === 'digital' && <Toggle on={device.on} onChange={v => onUpdate({ ...device, on: v })} />}
        </div>
      </div>
      {device.type === 'analog' ? (
        <div className="sh-card-body"><AnimatedReadout value={device.value} max={max} /><Slider value={device.value} max={max} onChange={(v, isFinal) => onUpdate({ ...device, value: v }, isFinal)} /></div>
      ) : (
        <div className="sh-card-body digital">
          <div className="sh-card-state"><span className={`sh-state-pill ${device.on ? 'on' : ''}`}><i />{device.on ? 'ACTIVE' : 'STANDBY'}</span></div>
        </div>
      )}
      <div className="sh-card-topics mono" style={{ fontSize: 9, opacity: 0.5, marginTop: 12 }}>
        {device.pubTopic && <div>PUB: {device.pubTopic}</div>}
        {device.subTopic && <div>SUB: {device.subTopic}</div>}
      </div>
    </motion.div>
  )
})

export default DeviceCard

export function AddDeviceTile({ onClick }) {
  return (
    <motion.button className="sh-card sh-add" onClick={onClick} variants={cardVariants} whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      <Icon name="plus" size={22} /><div>Add Device</div>
    </motion.button>
  )
}