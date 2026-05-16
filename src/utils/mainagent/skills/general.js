// general — คุยเล่น/ทักทาย/ถาม clarify
// step ที่ออกมาในรอบนี้ทั้งหมดเป็น general → graph จะไป chat node แทน
// ไม่ได้เป็น "tool" ที่ execute จริง — handler แค่ส่ง response string คืน

export const general = {
  type: 'general',
  requiresSkill: null,  // ไม่ต้องเปิด skill ใน settings

  planPrompt: `general — คุยเล่น/ทักทาย/ถาม clarify/ตอบจากความรู้ทั่วไป
ใช้เมื่อ user ทักทาย คุยเล่น ขอบคุณ ถามอะไรทั่วไป หรือเมื่อข้อมูลยังไม่ชัดต้องถามก่อน

หลักสำคัญมาก — "ชัดเจน" หมายถึงมีข้อมูลครบพอจะ execute ได้ทันที:
- "เพิ่ม 2 องศา" "ลด 3 องศา" "เพิ่มอีก 1" = ชัดแล้ว → คำนวณจาก state ปัจจุบันใน KG แล้ว execute (ไม่ต้อง general)
- "ตั้ง 25 องศา" "ปิดไฟ" "เปิดพัดลม" = ชัดแล้ว → execute (ไม่ต้อง general)
- "เปิดแอร์" ไม่มีเลขเลย = ยังไม่ชัด → general ถามว่า "จะให้ตั้งกี่องศาดีคะ?"

ถ้ารอบนี้มีคำสั่งที่ยังไม่ชัดจริงๆ ให้ใส่ general ถามก่อน แล้วอย่ารันอะไรอื่นในรอบนี้
(แม้คำสั่งอื่นจะชัดแล้ว) — รอถามให้ครบก่อน แล้วค่อยรันทีเดียวรอบหน้า`,

  example: `{"type": "general", "response": "คำตอบหรือคำถาม clarify สั้นๆ"}`,

  // ไม่ถูกเรียกจาก planExecutor ตรงๆ เพราะ graph route ไป chat node
  // มี execute ไว้เผื่อกรณี plan ผสม (general + อื่น) ซึ่ง mockup ห้ามอยู่แล้ว แต่ defensive
  async execute(step) {
    return {
      ok: true,
      summary: `ข้อมูลทั่วไป/คุยเล่น: ${step.response || ''}`,
    }
  },

  label(step) {
    return step.response ? `คุยเล่น: ${step.response.slice(0, 40)}` : 'คุยเล่น'
  },
}
