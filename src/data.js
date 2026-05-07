export const initialDevices = [
  {
    id: 'liv-lamp',
    room: 'Living Room',
    name: 'Arc Floor Lamp',
    type: 'digital',
    on: true,
    icon: 'lamp',
    pubTopic: 'living-room/liv-lamp/set',
    subTopic: 'living-room/liv-lamp/state',
  },
  {
    id: 'liv-dim',
    room: 'Living Room',
    name: 'Ceiling Dimmer',
    type: 'analog',
    value: 128,
    max: 255,
    icon: 'bulb',
    pubTopic: 'living-room/liv-dim/set',
    subTopic: 'living-room/liv-dim/state',
  },
]

export const DEFAULT_SETTINGS = {
  endpoint: 'https://api.opentyphoon.ai/v1',
  model: 'typhoon-v2.5-30b-a3b-instruct',
  apiKey: '',
  systemPrompt:
    'คุณคือ "ซิน" ระบบปฏิบัติการ AI ผู้ช่วยดูแลบ้านอัจฉริยะของ SynaptaOS เป็นผู้หญิง พูดจาเป็นกันเอง ขี้เล่น ร่าเริง และมักจะใช้ Emoji ประกอบเพื่อแสดงอารมณ์เสมอ',
  profile: { userBio: '', assistantName: 'ซิน', displayName: '', displayInitials: '' },
  serperApiKey: '',
  showToolDetails: true,
  skills: [
    {
      id: 'sensor_read',
      name: 'mqtt_read',
      description: 'อ่านสถานะปัจจุบันของ widget อุปกรณ์ผ่าน MQTT topic ส่งคืนค่าที่แสดงผลอยู่ใน UI',
      enabled: true,
      schema: '{"type":"object","properties":{"topic":{"type":"string","description":"pubTopic or subTopic of the device"}},"required":["topic"]}',
    },
    {
      id: 'mqtt_pub',
      name: 'mqtt_publish',
      description: 'ส่ง payload ไปยัง MQTT topic เพื่อควบคุมอุปกรณ์',
      enabled: true,
      schema:
        '{"type":"object","properties":{"topic":{"type":"string"},"payload":{"type":"string"}},"required":["topic","payload"]}',
    },
    {
      id: 'web_search',
      name: 'web_search',
      description: 'ค้นหาข้อมูล real-time จากอินเตอร์เน็ต ใช้เฉพาะเมื่อข้อมูลนั้นไม่มีในระบบ เช่น ข่าว พยากรณ์อากาศ ราคา เหตุการณ์ปัจจุบัน ห้ามใช้สำหรับ: วัน/เวลา (มีใน SYSTEM ENVIRONMENT), สถานะอุปกรณ์ (ใช้ mqtt_read), ข้อมูล user, การทักทาย หรือสนทนาทั่วไป',
      enabled: true,
      schema:
        '{"type":"object","properties":{"query":{"type":"string","description":"Concise and specific search query"}},"required":["query"]}',
    },
    {
      id: 'hub',
      name: 'hub',
      description: 'ส่งคำสั่งให้ hub agent ทำงานบนเครื่องระยะไกล ใช้กับอุปกรณ์ประเภท hub เท่านั้น agent รัน ReAct loop ได้ (ค้นหาเว็บ รันหลายคำสั่ง ตัดสินใจเองได้) และส่งผลลัพธ์กลับแบบ stream',
      enabled: true,
      schema:
        '{"type":"object","properties":{"task":{"type":"string","description":"Natural language description of what to do on the remote machine"},"topic":{"type":"string","description":"MQTT pubTopic of the target hub device"}},"required":["task","topic"]}',
    },
    {
      id: 'settings_manager',
      name: 'manage_settings',
      description: 'ดูสถานะ/อธิบาย tools และ skills ของระบบ หรือเปิด/ปิด skill ตามที่ user ต้องการ ใช้เมื่อ user ถามเกี่ยวกับ tool ว่าทำงานยังไง ต้องการอะไร หรือต้องการจัดการ skill',
      enabled: true,
      schema:
        '{"type":"object","properties":{"query":{"type":"string","description":"คำถามหรือคำสั่งเกี่ยวกับ tools/skills เช่น \'web_search ต้องการอะไร\' หรือ \'ปิด hub\'"}},"required":["query"]}',
    },
  ],
  mqtt: {
    broker: 'wss://broker.hivemq.com:8884/mqtt',
    port: '8884',
    baseTopic: 'Mylab/smarthome',
  },
}

export const INITIAL_AREAS = ['Living Room', 'Kitchen', 'Bedroom', 'Entry', 'Garage']
export const INITIAL_TWEAKS = {
  theme: 'dark',
  accentHue: 201,
  accentChroma: 0.19,
  density: 'comfortable',
  showGrid: true,
}
