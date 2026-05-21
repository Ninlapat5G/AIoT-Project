// general — สนทนาทั่วไป/ทักทาย/ถามข้อมูลเพิ่มเติม
// step ที่ออกมาในรอบนี้ทั้งหมดเป็น general → graph จะไป chat node แทน
// ไม่ได้เป็น "tool" ที่ execute จริง

export const general = {
  type: 'general',
  requiresSkill: null,  // ไม่ต้องเปิด skill ใน settings

  planPrompt: `[general]
ใช้สำหรับ: สนทนาทั่วไป, ทักทาย, ถามความรู้ที่ไม่ต้องข้อมูล real-time, ถามเพื่อขอรายละเอียดเพิ่ม
เงื่อนไข: ถ้าข้อมูลไม่ครบ (เช่น "เปิดแอร์" แต่ไม่บอกองศา) → ให้ถามก่อน อย่าสั่ง home_control`,

  label() {
    return 'สนทนาทั่วไป'
  },
}
