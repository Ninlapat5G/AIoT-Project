// general — สนทนาทั่วไป/ทักทาย/ถาม clarify
// step ที่ออกมาในรอบนี้ทั้งหมดเป็น general → graph จะไป chat node แทน
// ไม่ได้เป็น "tool" ที่ execute จริง — handler แค่ส่ง response string คืน

export const general = {
  type: 'general',
  requiresSkill: null,  // ไม่ต้องเปิด skill ใน settings

  planPrompt: `general — สำหรับสนทนาทั่วไป ทักทาย ถามเพื่อขอข้อมูลเพิ่ม หรือตอบคำถามความรู้ทั่วไป/วิชาการที่ไม่ได้อิงกับข้อมูลแบบ Real-time
**สำคัญมาก:** ถ้าข้อมูลยังไม่ครบที่จะทำงาน (เช่น สั่ง "เปิดแอร์" แต่ไม่บอกอุณหภูมิ) ให้ใช้ general เพื่อถามว่า "จะให้ตั้งกี่องศาดีคะ?" อย่าเพิ่งเรียก home_control จนกว่าข้อมูลจะครบพร้อมทำ`,

  example: `{"type": "general", "response": "คำตอบหรือคำถาม clarify สั้นๆ"}`,

  // ไม่ถูกเรียกจาก planExecutor ตรงๆ เพราะ graph route ไป chat node
  // มี execute ไว้เผื่อกรณี plan ผสม (general + อื่น) ซึ่ง mockup ห้ามอยู่แล้ว แต่ defensive
  async execute(step) {
    return {
      ok: true,
      summary: `สนทนาทั่วไป: ${step.response || ''}`,
    }
  },

  label() {
    return 'สนทนาทั่วไป'
  },
}
