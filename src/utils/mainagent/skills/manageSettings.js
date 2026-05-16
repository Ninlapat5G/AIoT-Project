// settings — ดู/เปิด-ปิด skill / อธิบาย tool
//
// step shape: { type: 'settings', query }
// sub-agent: ใช้ runSettingsAgent ที่มีอยู่แล้ว (มี read_settings + toggle_skill tools)

import { runSettingsAgent } from '../../settingsAgent.js'

export const manageSettings = {
  type: 'settings',
  requiresSkill: 'manage_settings',

  planPrompt: `settings — จัดการเรื่อง skill / tool / การตั้งค่าระบบ
ใช้เมื่อ user:
- ถามว่า tool/skill ไหนทำงานยังไง ต้องการอะไร ใช้งานไม่ได้ทำไม
- ขอให้เปิด/ปิด skill
- ถามสถานะ API key, model, MQTT settings (read-only)

ใส่ field "query" เป็นคำถาม/คำสั่งเดิมของ user ที่เกี่ยวข้องกับ settings
(sub-agent จะตีความและจัดการเอง)`,

  example: `{"type": "settings", "query": "ปิด skill web_search"}`,

  async execute(step, ctx) {
    const { settings, handleSaveSettings, devicesRef, signal } = ctx
    const query = step.query
    if (!query) return { ok: false, summary: `✗ settings: ไม่มี query` }

    try {
      const response = await runSettingsAgent({
        query,
        settings,
        devicesRef,
        onSettingsChange: handleSaveSettings,
        signal,
      })
      return { ok: true, summary: response || 'จัดการเรียบร้อย' }
    } catch (err) {
      return { ok: false, summary: `✗ settings: ${err.message}` }
    }
  },

  label(step) {
    return `Settings: ${String(step.query || '').slice(0, 40)}`
  },
}
