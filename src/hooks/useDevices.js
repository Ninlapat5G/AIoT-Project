import { useState, useRef, useEffect, useCallback } from 'react'
import { initialDevices } from '../data'
import { saveDevices, loadDevices } from '../utils/storage'
import { normalizeBase, buildCmdTopic, buildStateTopic } from '../utils/mqttTopic'

function migrateDevice(d) {
  if (!d.topic && d.pubTopic) {
    return { ...d, topic: d.pubTopic.replace(/\/set$/, ''), pin: d.pin ?? '' }
  }
  return d
}

// onNodeStatus(nodeId, status) — App.jsx ใช้แสดง toast
// onDevicesAdded(manifest, addedDevices) — App.jsx ใช้แสดง toast "พบอุปกรณ์ใหม่"
export function useDevices({ baseTopicRef, onNodeStatus, onDevicesAdded }) {
  const [devices, setDevices] = useState(() =>
    (loadDevices() ?? initialDevices).map(migrateDevice)
  )

  const devicesRef = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])

  useEffect(() => { saveDevices(devices) }, [devices])

  const onNodeStatusRef = useRef(onNodeStatus)
  useEffect(() => { onNodeStatusRef.current = onNodeStatus }, [onNodeStatus])

  const onDevicesAddedRef = useRef(onDevicesAdded)
  useEffect(() => { onDevicesAddedRef.current = onDevicesAdded }, [onDevicesAdded])

  // สถานะล่าสุดของแต่ละ node (nodeId → 'online'|'offline') — ใช้เด้ง toast เฉพาะตอนเปลี่ยนจริง
  const nodeStatusRef = useRef({})
  // ตัวจับเวลาหน่วง toast 'offline' (nodeId → timeoutId) — กันเน็ตกระตุก
  const offlineTimersRef = useRef({})
  useEffect(() => () => {
    Object.values(offlineTimersRef.current).forEach(clearTimeout)
  }, [])

  function isValidControlVal(val) {
    const v = String(val).toLowerCase().trim()
    if (['on', 'off', '1', '0', 'true', 'false'].includes(v)) return true
    return !isNaN(parseInt(v, 10))
  }

  const handleMqttMessage = useCallback((topic, val, packet) => {
    // node status: {base}/nodes/{id}/status
    if (/\/nodes\/[^/]+\/status$/.test(topic)) {
      const nodeId = topic.split('/nodes/')[1]?.split('/')[0]
      if (!nodeId) return

      // retained snapshot ตอนเพิ่ง subscribe — จำสถานะไว้เฉย ๆ ไม่ต้องเด้ง toast
      if (packet?.retain) { nodeStatusRef.current[nodeId] = val; return }

      if (val === 'offline') {
        // หน่วง 3 วิ กันเน็ตกระตุก — ถ้า node กลับมา online ทัน timer จะถูกยกเลิก
        if (offlineTimersRef.current[nodeId]) return
        offlineTimersRef.current[nodeId] = setTimeout(() => {
          delete offlineTimersRef.current[nodeId]
          if (nodeStatusRef.current[nodeId] === 'offline') return
          nodeStatusRef.current[nodeId] = 'offline'
          onNodeStatusRef.current?.(nodeId, 'offline')
        }, 3000)
        return
      }

      // online (หรือสถานะอื่น) — ยกเลิก offline ที่ค้างอยู่ และเด้งเฉพาะตอนสถานะเปลี่ยนจริง
      if (offlineTimersRef.current[nodeId]) {
        clearTimeout(offlineTimersRef.current[nodeId])
        delete offlineTimersRef.current[nodeId]
      }
      if (nodeStatusRef.current[nodeId] === val) return
      nodeStatusRef.current[nodeId] = val
      onNodeStatusRef.current?.(nodeId, val)
      return
    }

    // node manifest: {base}/nodes/{id}/manifest — auto-discovery + ลบข้ามเครื่อง
    if (/\/nodes\/[^/]+\/manifest$/.test(topic)) {
      const nodeId = topic.split('/nodes/')[1]?.split('/')[0]
      if (!nodeId) return

      // manifest ว่าง = node ถูกลบจากเครื่องอื่น → เอาอุปกรณ์ของ node นี้ออกทั้งหมด
      if (!val.trim()) {
        setDevices(prev => prev.filter(d => d.nodeId !== nodeId))
        return
      }

      try {
        const manifest = JSON.parse(val)
        if (!manifest) return
        const manifestTopics = new Set((manifest.devices || []).map(md => md.topic).filter(Boolean))

        // setDevices จัดการได้เองโดยตรง — ไม่มี circular dep
        setDevices(prev => {
          // อุปกรณ์ใหม่ที่ยังไม่มี → เพิ่ม (ของเดิมไม่แตะ ชื่อที่ผู้ใช้แก้ไว้จึงไม่ถูกเขียนทับ)
          const toAdd = (manifest.devices || [])
            .filter(md => md.topic && !prev.some(d => d.topic === md.topic))
            .map(md => ({
              id:         `disc-${md.topic.replace(/[^a-z0-9]/gi, '-')}`,
              name:       md.name || md.topic.split('/').pop() || md.topic,
              room:       'Living Room',
              type:       md.type === 'analog' ? 'analog' : 'digital',
              on:         false,
              icon:       'bulb',
              topic:      md.topic,
              pin:        md.pin ?? '',
              nodeId:     manifest.nodeId,
              configured: md.configured ?? true,
              ...(md.type === 'analog' ? { value: 0, max: 255 } : {}),
            }))

          // อุปกรณ์ของ node นี้ที่หายไปจาก manifest = ถูกลบจากเครื่องอื่น → เอาออก
          const kept = prev.filter(d => d.nodeId !== nodeId || manifestTopics.has(d.topic))

          if (toAdd.length === 0 && kept.length === prev.length) return prev
          // callback เพื่อแสดง toast — ทำหลัง state update
          if (toAdd.length > 0) setTimeout(() => onDevicesAddedRef.current?.(manifest, toAdd), 0)
          return [...kept, ...toAdd]
        })
      } catch { /* ignore malformed manifest */ }
      return
    }

    if (!isValidControlVal(val)) return

    const base = normalizeBase(baseTopicRef.current)
    const incoming = topic.trim()

    setDevices(prev => {
      let matched = false
      const next = prev.map(d => {
        if (!d.topic) return d
        if (
          incoming !== buildStateTopic(d.topic, base) &&
          incoming !== buildCmdTopic(d.topic, base)
        ) return d

        matched = true
        if (d.type === 'digital')
          return { ...d, on: val === 'true' || val === '1' || val === 'on' || val === 'ON' }
        if (d.type === 'analog')
          return { ...d, value: Math.max(0, Math.min(d.max ?? 255, parseInt(val, 10) || 0)) }
        return d
      })
      return matched ? next : prev
    })
  }, [baseTopicRef])

  const removeDevice = useCallback(id => {
    setDevices(prev => prev.filter(x => x.id !== id))
  }, [])

  return { devices, setDevices, devicesRef, handleMqttMessage, removeDevice }
}
