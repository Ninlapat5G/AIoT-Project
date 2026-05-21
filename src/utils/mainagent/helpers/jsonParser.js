// ดัก JSON จาก LLM response — รองรับทั้ง ```json``` block และปีกกาล้วน
// คืน null เมื่อ parse ไม่ได้ (ไม่ throw) — caller จัดการต่อเองได้
export function parseJSON(text) {
  const s = String(text || '').trim()

  const fence = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (fence) {
    try { return JSON.parse(fence[1]) } catch { /* fall through */ }
  }

  const bare = s.match(/\{[\s\S]*\}/)
  if (bare) {
    try { return JSON.parse(bare[0]) } catch { /* fall through */ }
  }

  console.warn('[parseJSON] ไม่พบ JSON ใน response:', s.slice(0, 200))
  return null
}
