// realtime_data — ค้นข้อมูลออนไลน์ผ่าน Serper
//
// step shape: { type: 'realtime_data', query }
// ไม่มี sub-LLM — router_planner ใส่ query ที่กระชับมาแล้วใน plan

const SERPER_URL = 'https://google.serper.dev/search'

export const realtimeData = {
  type: 'realtime_data',
  requiresSkill: 'web_search',

  planPrompt: `[realtime_data]
ใช้สำหรับ: ข้อมูล real-time จากอินเทอร์เน็ต (ข่าว, ราคาหุ้น/คริปโต, พยากรณ์อากาศ, เหตุการณ์ปัจจุบัน) หรือ user สั่งให้ค้นโดยตรง
เงื่อนไข:
- ห้ามใช้กับวัน/เวลา (อยู่ใน KG แล้ว) หรือสถานะอุปกรณ์ (อยู่ใน KG แล้ว)
- ห้ามใช้กับความรู้ทั่วไปที่ไม่ต้อง real-time → ใช้ general แทน
- query ใส่ keyword สั้นๆ ตรงประเด็น เติม "ล่าสุด"/"วันนี้" ถ้าจำเป็น`,

  example: `{"type": "realtime_data", "query": "พยากรณ์อากาศกรุงเทพ วันนี้"}`,

  async execute(step, ctx) {
    const { settings, signal } = ctx
    const query = step.query
    if (!query) return { ok: false, summary: `✗ web_search: ไม่มี query` }

    const apiKey = settings.serperApiKey
    if (!apiKey) {
      return {
        ok: false,
        summary: `✗ web_search: ยังไม่ได้ตั้ง Serper API key — แจ้ง user`,
      }
    }

    let res
    try {
      res = await fetch(SERPER_URL, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 3 }),
        signal,
      })
    } catch (err) {
      return { ok: false, summary: `✗ web_search: Network error: ${err.message}` }
    }

    if (res.status === 401 || res.status === 403) return { ok: false, summary: `✗ web_search: API key ไม่ถูกต้องหรือ quota หมด` }
    if (res.status === 429) return { ok: false, summary: `✗ web_search: rate limit` }
    if (!res.ok) return { ok: false, summary: `✗ web_search: HTTP ${res.status}` }

    const data = await res.json()
    const parts = []

    if (data.answerBox?.answer) parts.push(data.answerBox.answer)
    else if (data.answerBox?.snippet) parts.push(data.answerBox.snippet)
    if (data.knowledgeGraph?.description) {
      parts.push(`${data.knowledgeGraph.title}: ${data.knowledgeGraph.description}`)
    }
    const organic = (data.organic || []).slice(0, 3)
    if (organic.length) {
      parts.push(organic.map(r => `${r.title}\n${r.snippet}\n${r.link}`).join('\n\n'))
    }

    const summary = parts.join('\n\n') || 'No results found'
    return { ok: true, summary: `ผลการค้นหา "${query}": ${summary}` }
  },

  label(step) {
    return `ค้น: ${String(step.query || '').slice(0, 40)}`
  },
}
