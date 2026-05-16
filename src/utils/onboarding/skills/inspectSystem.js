// inspect_system — อ่านสถานะการตั้งค่าระบบ (no LLM)

import { DEFAULT_API_KEY } from '../../../config/default_key.js'

export const inspectSystem = {
  type: 'inspect_system',

  planPrompt: `inspect_system — เช็คสถานะการตั้งค่าระบบปัจจุบัน (Typhoon key, Serper key, model, devices)
ใช้เมื่อ:
- stage = "setup" และจะแนะนำตั้งค่า API key
- user ถามว่าตั้งค่าเสร็จยัง หรือสถานะตอนนี้เป็นไง`,

  example: `{"type": "inspect_system"}`,

  responseGuide: `ดึงค่าจาก [สิ่งที่ดำเนินการ] มาแนะนำต่อ:
- ถ้า Typhoon ยังใช้ key เริ่มต้น → ชี้ลิงค์ https://playground.opentyphoon.ai/settings/api-key พร้อมเหตุผล (key สาธารณะอาจช้า/หมด quota)
- ถ้า Serper ยังไม่ตั้ง → ลิงค์ https://serper.dev/api-keys (optional)`,

  async execute(step, ctx) {
    const { settings, devicesRef } = ctx
    const usingDefault = !settings.apiKey || settings.apiKey === DEFAULT_API_KEY

    const status = {
      typhoonApiKey: usingDefault
        ? 'ยังใช้ key เริ่มต้นของระบบ (แนะนำให้เปลี่ยนเป็น key ส่วนตัว)'
        : 'ตั้งค่า key ส่วนตัวแล้ว ✓',
      serperApiKey: settings.serperApiKey
        ? 'ตั้งค่าแล้ว ✓ (ใช้ web search ได้)'
        : 'ยังไม่ได้ตั้งค่า — optional',
      userName: settings.profile?.userBio || 'ยังไม่ได้ระบุ',
      model: settings.model,
      devicesConfigured: devicesRef?.current?.length ?? 0,
    }

    const summary = [
      `Typhoon: ${status.typhoonApiKey}`,
      `Serper: ${status.serperApiKey}`,
      `Model: ${status.model}`,
      `Devices: ${status.devicesConfigured} ตัว`,
    ].join(' | ')

    return { ok: true, summary }
  },

  label() { return 'เช็คสถานะระบบ' },
}
