// settings — ดู/เปิด-ปิด skill / อธิบาย tool
//
// step shape: { type: 'settings', query }
// sub-agent: ใช้ runSettingsAgent ที่มีอยู่แล้ว (มี read_settings + toggle_skill tools)

import { runSettingsAgent } from '../../settingsAgent.js'

export const manageSettings = {
  type: 'settings',
  requiresSkill: 'manage_settings',

  planPrompt: `[settings]
ใช้สำหรับ: ถามเรื่อง skill/tool, เปิด/ปิด skill, ถามสถานะ API key หรือการตั้งค่าระบบ
เงื่อนไข: ใส่ "query" เป็นคำถาม/คำสั่งของ user ตรงๆ (sub-agent ตีความเอง)`,

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
