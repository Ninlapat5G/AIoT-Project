// Trim whitespace and strip trailing slashes from baseTopic
export function normalizeBase(base) {
  return (base || '').trim().replace(/\/+$/, '')
}

// Build the canonical full MQTT path: base/suffix.
// Strips leading slashes and any accidental baseTopic prefix from the suffix
// so callers that stored the full path don't create double-prefix paths.
export function buildFullTopic(topic, base) {
  let t = (topic || '').trim().replace(/^\/+/, '')
  if (base && t.startsWith(base + '/')) t = t.slice(base.length + 1)
  return base ? `${base}/${t}` : t
}

// ── Derived topic helpers ─────────────────────────────────────────────────────
// รับ device.topic (เช่น "living-room/lamp") + baseTopic
// คืน full path พร้อม suffix ที่ถูกต้อง

// web → board: สั่งเปิด/ปิด หรือตั้งค่า
export function buildCmdTopic(topic, base) {
  return buildFullTopic(topic + '/set', base)
}

// board → web: รายงาน state ปัจจุบัน
export function buildStateTopic(topic, base) {
  return buildFullTopic(topic + '/state', base)
}

// web → board: ส่ง pin config ตอนกด save ใน web app
export function buildConfigTopic(topic, base) {
  return buildFullTopic(topic + '/config', base)
}
