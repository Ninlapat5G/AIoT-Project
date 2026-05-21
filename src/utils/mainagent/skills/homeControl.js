// home_control — เปิด/ปิด/ปรับ device ผ่าน mqtt_publish
//
// step shape: { type: 'home_control', device, topic, payload }
//
// LLM ต้องระบุ topic ที่ตรงกับ KG เท่านั้น — ห้ามเดา

import { findDeviceByTopic } from '../../kg.js'
import { normalizeBase, buildCmdTopic } from '../../mqttTopic.js'

export const homeControl = {
  type: 'home_control',
  requiresSkill: 'mqtt_publish',

  planPrompt: `[home_control]
ใช้สำหรับ: เปิด/ปิด/ปรับ device ในบ้านผ่าน MQTT
เงื่อนไข:
- ใช้ topic จาก KG เท่านั้น ห้ามเดา
- "ทุก X" → 1 step ต่อ 1 device
- digital → payload "ON" หรือ "OFF"
- analog → payload เป็นตัวเลข absolute (คำนวณจาก state ใน KG ถ้าบอกเพิ่ม/ลด เช่น "เพิ่ม 5")
- analog ที่ user ไม่ระบุค่าเป้าหมาย → ห้ามเดาหรือใช้ค่าจาก KG เป็น default ให้ใช้ general ถามก่อน
- ห้ามใช้กับ hub device → ใช้ hub_control แทน
- ถ้า device ไม่มีใน KG → ใช้ device_not_found`,

  example: `{"type": "home_control", "device": "ไฟห้องนั่งเล่น", "topic": "living-room/liv-lamp", "payload": "OFF"}`,

  async execute(step, ctx) {
    const { mqttClient, devicesRef, baseTopicRef, setDevices } = ctx
    const topic = step.topic
    const payload = step.payload != null ? String(step.payload) : ''

    if (!mqttClient) return { ok: false, summary: `✗ ${step.device || topic}: MQTT ไม่เชื่อมต่อ` }
    if (!topic)      return { ok: false, summary: `✗ ${step.device || 'อุปกรณ์'}: ขาด topic ใน step` }

    const devices = devicesRef.current || []
    const device = findDeviceByTopic(devices, topic)
    if (!device) return { ok: false, summary: `✗ ${step.device || topic}: ไม่พบ device ที่ topic ${topic}` }
    if (device.type === 'hub') {
      return { ok: false, summary: `✗ ${device.name}: เป็น hub device ต้องใช้ hub_control` }
    }

    const base = normalizeBase(baseTopicRef.current)
    const fullTopic = buildCmdTopic(device.topic, base)
    const prevVal = device.type === 'analog' ? device.value : null

    return new Promise(resolve => {
      mqttClient.publish(fullTopic, payload, { qos: 2 }, err => {
        if (err) {
          resolve({ ok: false, summary: `✗ ${device.name}: ${err.message}` })
          return
        }

        // อัปเดต state ทั้ง ref + React state
        const applyUpdate = d => {
          if (d.id !== device.id) return d
          if (d.type === 'digital') return { ...d, on: payload === 'true' || payload === 'ON' || payload === '1' }
          if (d.type === 'analog')  return { ...d, value: parseInt(payload, 10) || 0 }
          return d
        }
        devicesRef.current = devicesRef.current.map(applyUpdate)
        setDevices?.(prev => prev.map(applyUpdate))

        let summary
        if (device.type === 'analog') {
          summary = prevVal != null
            ? `${device.name} ปรับจาก ${prevVal} → ${payload}`
            : `${device.name} ตั้งเป็น ${payload}`
        } else {
          const on = payload === 'true' || payload === 'ON' || payload === '1'
          summary = `${on ? 'เปิด' : 'ปิด'} ${device.name}`
        }
        resolve({ ok: true, summary, device: device.name })
      })
    })
  },

  label(step) {
    if (!step.payload) return step.device || 'home control'
    const p = String(step.payload).toUpperCase()
    if (p === 'ON' || p === 'TRUE' || p === '1')  return `เปิด ${step.device}`
    if (p === 'OFF' || p === 'FALSE' || p === '0') return `ปิด ${step.device}`
    return `ตั้ง ${step.device} = ${step.payload}`
  },
}
