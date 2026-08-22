// device.type → skill ที่ต้องเปิดถึงจะควบคุมได้
const DEVICE_TYPE_TO_SKILLS = {
  digital: ['mqtt_publish'],
  analog:  ['mqtt_publish'],
  hub:     ['hub'],
}

export function getEnabledSkills(settings) {
  return new Set((settings?.skills || []).filter(s => s.enabled).map(s => s.name))
}

export function visibleDevices(devices, settings) {
  const enabled = getEnabledSkills(settings)
  return (devices || []).filter(d => {
    const required = DEVICE_TYPE_TO_SKILLS[d.type]
    if (!required) return true
    return required.some(skill => enabled.has(skill))
  })
}

export function findDeviceByTopic(devices, topic) {
  if (!topic) return null
  const list = devices || []

  // จับคู่ตรงตัวก่อนเสมอ — กรณีปกติที่สุด (step.topic มาจาก KG โดยตรง)
  const exact = list.find(d => d.topic === topic)
  if (exact) return exact

  // รองรับกรณีที่ topic เป็น full /set หรือ /state path
  const withSuffix = list.find(d => d.topic && (topic === d.topic + '/set' || topic === d.topic + '/state'))
  if (withSuffix) return withSuffix

  // fallback แบบ suffix match — ใช้เฉพาะตอนไม่กำกวม (เจอตัวเดียว)
  // กันสั่งผิดอุปกรณ์เมื่อ topic สั้นไปตรงกับ suffix ของหลายตัว
  const suffixMatches = list.filter(d => d.topic && d.topic.endsWith('/' + topic))
  return suffixMatches.length === 1 ? suffixMatches[0] : null
}

export function findDeviceByName(devices, name) {
  if (!name) return null
  const target = String(name).trim().toLowerCase()
  return (devices || []).find(d => String(d.name || '').trim().toLowerCase() === target) || null
}

export function describeDeviceState(device) {
  if (!device) return 'unknown'
  if (device.type === 'digital') return device.on ? 'ON' : 'OFF'
  if (device.type === 'analog')  return `${device.value}/${device.max ?? 255}`
  if (device.type === 'sensor')  return `${device.value ?? '—'}${device.unit || ''}`
  return 'n/a'
}

export function knowledge_data({ devices, settings, now }) {
  const visible = visibleDevices(devices, settings)
  const userName = settings?.profile?.displayName || settings?.profile?.userBio || 'User'
  const userBio  = settings?.profile?.userBio || ''
  const enabledSkills = [...getEnabledSkills(settings)]

  const nonHubs = visible.filter(d => d.type !== 'hub')
  const hubs    = visible.filter(d => d.type === 'hub')

  const roomMap = new Map()
  for (const d of nonHubs) {
    const room = d.room || '(unsorted)'
    if (!roomMap.has(room)) roomMap.set(room, [])
    roomMap.get(room).push(d)
  }

  const lines = []
  lines.push('[สถานะบ้าน]')
  lines.push(`Time: ${now}`)
  lines.push(`User: ${userName}${userBio ? ` — ${userBio}` : ''}`)
  lines.push('')

  if (roomMap.size === 0 && hubs.length === 0) {
    lines.push('Rooms: (ไม่มี device ที่ active)')
  } else {
    lines.push('Rooms:')
    for (const [room, devs] of roomMap) {
      lines.push(`  ${room}`)
      devs.forEach((d, i) => {
        const last = i === devs.length - 1
        const branch = last ? '└─' : '├─'
        const state = describeDeviceState(d)
        lines.push(`    ${branch} ${d.name}  [${d.type} | ${state}]`)
        const indent = last ? '       ' : '    │  '
        lines.push(`${indent} topic: ${d.topic}`)
      })
    }
  }

  if (hubs.length > 0) {
    lines.push('')
    lines.push('Hubs:')
    hubs.forEach((h, i) => {
      const last = i === hubs.length - 1
      const branch = last ? '└─' : '├─'
      lines.push(`  ${branch} ${h.name} (${h.room})`)
      const indent = last ? '     ' : '  │  '
      lines.push(`${indent} topic: ${h.topic}`)
    })
  }

  lines.push('')
  lines.push(`Active Skills: ${enabledSkills.join(', ') || '(none)'}`)
  return lines.join('\n')
}
