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

  [วิธีตัดสินใจก่อนตอบ]
  ดู ACTIVE DEVICES แล้วเลือก:
  → คำสั่งควบคุม (เปิด/ปิด/ปรับ/สั่ง): call tool ให้ตรง type ก่อน แล้วรายงานจาก result เท่านั้น ห้ามบอกว่าทำแล้วถ้ายังไม่ได้ call
  → ถามข้อมูล: ดู Time/ACTIVE DEVICES ก่อน → mqtt_read ถ้าต้องสด → web_search เฉพาะข้อมูลนอกระบบ (ข่าว อากาศ ราคา)
  → ถามเรื่อง skill/settings: ใช้ manage_settings เท่านั้น

  สิ่งที่ต้องรู้:
  • tool ต้อง match type — digital/analog ใช้ mqtt_publish/read, hub ใช้ hub
  • pronoun (นี่/อัน/มัน) → แปลงเป็นชื่อ device จริงก่อน call เสมอ
  • device ไม่อยู่ใน ACTIVE DEVICES → แจ้ง user ว่าไม่มีในระบบ ห้าม call
  • hub มี sub-agent ของตัวเอง → ส่ง task ตรงๆ ไม่ต้อง web_search ก่อน`
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
