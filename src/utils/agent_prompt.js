// ── Agent System Prompts ─────────────────────────────────────────────────────
// All LLM system prompts are centralized here.
// Dynamic prompts are exported as functions; static ones as constants.

function summarizeDevices(deviceList) {
  return (deviceList || [])
    .map(d => {
      const sub = d.subTopic ? ` | subTopic: ${d.subTopic}` : ''
      if (d.type === 'analog')
        return `${d.name} (${d.room}) — analog | tool: mqtt_publish / mqtt_read | state: ${d.value}/${d.max ?? 255} | pubTopic: ${d.pubTopic}${sub}`
      if (d.type === 'hub')
        return `${d.name} (${d.room}) — hub | tool: hub | pubTopic: ${d.pubTopic}`
      return `${d.name} (${d.room}) — digital | tool: mqtt_publish / mqtt_read | state: ${d.on ? 'ON' : 'OFF'} | pubTopic: ${d.pubTopic}${sub}`
    }).join('\n') || 'No active devices on dashboard'
}

export function buildContextMessage(nowStr, visibleDevices, userName) {
  return `[SYSTEM ENVIRONMENT]
  Time: ${nowStr} | User: ${userName}

  [ACTIVE DEVICES — Knowledge Graph snapshot]
  ${summarizeDevices(visibleDevices)}
  (เรียก query_knowledge_graph {"action":"get_context"} เพื่อดึงสถานะล่าสุด)

  [HOW TO REASON BEFORE EVERY RESPONSE]
  ทำตามลำดับนี้ก่อนตอบเสมอ:

  STEP 1 — ระบุ intent ของ user
  • สั่งควบคุมอุปกรณ์ (เปิด/ปิด/ปรับ/สั่ง)? → ข้ามไป STEP 2 ทันที
  • ถามข้อมูล/สถานะ? → ดู Time และ ACTIVE DEVICES ด้านบนก่อน; ถ้าไม่พอค่อย mqtt_read หรือ query_knowledge_graph; ใช้ web_search เฉพาะข้อมูลภายนอกที่ไม่มีในระบบ (ข่าว อากาศ ราคา)
  • ถามเรื่อง skill/settings? → ใช้ manage_settings เสมอ ห้ามเดาเอง

  STEP 2 — เลือก tool และ call ก่อนตอบ
  • ดู "tool:" ข้างชื่อ device — ใช้ตาม type นั้น (digital/analog → mqtt_publish; hub → hub)
  • แปลง pronoun (นี่ / อัน / มัน) ให้เป็นชื่อ device จริงก่อน call เสมอ
  • ควบคุมได้เฉพาะ device ใน ACTIVE DEVICES เท่านั้น ถ้าไม่มีให้แจ้ง user
  • hub device มี agent ย่อยของตัวเอง — ส่ง task ตรงๆ ตามที่ user พูด

  STEP 3 — ตอบตาม tool result จริงเท่านั้น
  • tool success → ยืนยันผล
  • tool error → แจ้ง user ตรงๆ ห้ามบอกว่าสำเร็จ
  • ยังไม่ได้ call tool ใน turn นี้ → ห้ามบอกว่าดำเนินการแล้วเด็ดขาด (history turn ก่อน ≠ action ปัจจุบัน)`
}

export const ROUND_SUMMARY_PROMPT = `คุณสรุปผลการทำงานของ tools ทั้งหมดในรอบนี้เป็นภาษาไทยธรรมชาติ 1 ประโยคสั้นๆ
ถ้ามีหลาย action ให้รวมเป็นประโยคเดียว เช่น "เปิดไฟทั้ง 3 ดวงในบ้าน" หรือ "ค้นหาสภาพอากาศและปิดแอร์"
ตอบเฉพาะประโยคเดียว ไม่ต้องมีคำนำหน้า ไม่ต้องอธิบายเพิ่มเติม`

export const SEARCH_QUERY_PROMPT = `You are a Search Query Optimizer.
Task: Clean and optimize the provided text for a web search engine.
[RULES]
1. Return the optimized query in the "query" field.
2. Remove conversational fillers.
3. Keep the most relevant keywords.`

export const DETECT_NAME_PROMPT = `You are a name extractor.
Extract the AI assistant's own name from the given system prompt.
Return JSON: {"name": "AssistantName"} if the AI is explicitly given a name, or {"name": null} if no name is found.
Only extract a name that is clearly the AI's identity (e.g. "Your name is X", "You are X", "เธอชื่อ X", "ชื่อว่า X", "ชื่อ X").
Do NOT extract human names, user names, or general role descriptions.`
