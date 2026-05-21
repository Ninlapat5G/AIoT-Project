import { useState, useRef, useEffect, useCallback } from 'react'
import { initialDevices } from '../data'
import { saveDevices, loadDevices } from '../utils/storage'
import { normalizeBase, buildCmdTopic, buildStateTopic } from '../utils/mqttTopic'

// migration: device เก่าที่มี pubTopic/subTopic แต่ยังไม่มี topic
// derive topic จาก pubTopic โดยตัด /set suffix ออก
function migrateDevice(d) {
  if (!d.topic && d.pubTopic) {
    return { ...d, topic: d.pubTopic.replace(/\/set$/, ''), pin: d.pin ?? '' }
  }
  return d
}

/**
 * useDevices
 * จัดการ device list + persist ลง localStorage
 * handleMqttMessage sync state เมื่อมี MQTT message เข้า
 *
 * Params:
 *   baseTopicRef – ref จาก useSettings
 *
 * Returns:
 *   devices, setDevices, devicesRef, handleMqttMessage, removeDevice
 */
export function useDevices({ baseTopicRef }) {
  const [devices, setDevices] = useState(() =>
    (loadDevices() ?? initialDevices).map(migrateDevice)
  )

  const devicesRef = useRef(devices)
  useEffect(() => { devicesRef.current = devices }, [devices])

  useEffect(() => { saveDevices(devices) }, [devices])

  function isValidControlVal(val) {
    const v = String(val).toLowerCase().trim()
    if (['on', 'off', '1', '0', 'true', 'false'].includes(v)) return true
    return !isNaN(parseInt(v, 10))
  }

  // รับ MQTT message แล้ว match กับ device ที่ตรงกัน
  // match ทั้ง stateTopic (/state) และ cmdTopic (/set) เพราะ broker echo กลับ
  const handleMqttMessage = useCallback((topic, val) => {
    if (!isValidControlVal(val)) return  // ข้าม echo ที่ไม่ใช่ค่าควบคุมจริง

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
