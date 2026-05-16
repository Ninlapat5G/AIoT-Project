// explain_setup — directive: response node ใช้ guide นี้แนะนำ API key

export const explainSetup = {
  type: 'explain_setup',

  planPrompt: `explain_setup — แนะนำการตั้งค่า Typhoon + Serper API key
ใช้เมื่อ:
- stage = "setup"
- user ถามว่าจะตั้งค่ายังไง / ต้องทำอะไรต่อ
- หลังบันทึกชื่อใหม่`,

  example: `{"type": "explain_setup"}`,

  responseGuide: `[ขั้นตอน: แนะนำตั้งค่า]
อธิบายเหตุผลก่อนบอกให้ทำ — อย่าแค่บอกให้ทำ:
- Typhoon API key = สมองของ AI ถ้าไม่ใส่จะใช้ key สาธารณะที่อาจช้าหรือหมด quota — จำเป็น
  ลิงค์: https://playground.opentyphoon.ai/settings/api-key
- Serper API key = ช่วยให้ AI ค้นข้อมูลจากอินเทอร์เน็ตได้ ถ้าไม่ใส่ก็ใช้ได้ปกติ — optional
  ลิงค์: https://serper.dev/api-keys

อ่าน [สิ่งที่ดำเนินการ] เพื่อรู้สถานะปัจจุบัน แล้วชี้ไปยังขั้นที่ user ยังไม่ทำ`,

  async execute() {
    return { ok: true, summary: 'พร้อมอธิบายการตั้งค่า' }
  },

  label() { return 'อธิบายการตั้งค่า API key' },
}
