// farewell — directive: response node ใช้ guide นี้กล่าวลา

export const farewell = {
  type: 'farewell',

  planPrompt: `farewell — กล่าวลา ส่งต่อให้ AI หลัก
ใช้เมื่อ:
- stage = "farewell"
- user ตั้ง Typhoon API key ที่ใช้งานได้แล้ว`,

  example: `{"type": "farewell"}`,

  responseGuide: `[ขั้นตอน: กล่าวลา]
user ตั้งค่า Typhoon API key เสร็จแล้ว ระบบตรวจสอบแล้วว่าใช้งานได้
ส่ง farewell message อบอุ่น น่ารัก บอกว่าซินออกไปแล้ว
AI หลักจะเข้ามาดูแลแทน อาจทิ้ง hint เล็กน้อยเกี่ยวกับสิ่งที่ทำได้
จบด้วยคำอำลาสั้นๆ น่ารักๆ`,

  async execute() {
    return { ok: true, summary: 'พร้อมกล่าวลา' }
  },

  label() { return 'กล่าวลา' },
}
