// device_not_found — user พูดถึง device ที่ไม่มีใน KG

export const deviceNotFound = {
  type: 'device_not_found',
  requiresSkill: null,

  planPrompt: `device_not_found — user พูดถึงอุปกรณ์ที่ไม่มีใน KG เลย
ห้ามเดาเอง ห้ามเปลี่ยนเป็นตัวอื่น
ใส่ field "device" บอกชื่อที่ user พูดถึง`,

  example: `{"type": "device_not_found", "device": "ชื่อ device ที่ user พูดถึง"}`,

  async execute(step) {
    const name = step.device || 'อุปกรณ์'
    return {
      ok: false,
      summary: `✗ ไม่พบ "${name}" ในระบบ`,
    }
  },

  label(step) {
    return `ไม่พบ ${step.device || 'อุปกรณ์'}`
  },
}
