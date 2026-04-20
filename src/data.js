export const initialDevices = [
  {
    id: 'liv-lamp',
    room: 'Living Room',
    name: 'Arc Floor Lamp',
    type: 'digital',
    on: true,
    icon: 'lamp',
    pubTopic: 'Mylab/smarthome/living-room/liv-lamp/set',
    subTopic: 'Mylab/smarthome/living-room/liv-lamp/state',
  },
  {
    id: 'liv-dim',
    room: 'Living Room',
    name: 'Ceiling Dimmer',
    type: 'analog',
    value: 128,
    icon: 'bulb',
    pubTopic: 'Mylab/smarthome/living-room/liv-dim/set',
    subTopic: 'Mylab/smarthome/living-room/liv-dim/state',
  },
]

export const DEFAULT_SETTINGS = {
  endpoint: 'https://api.opentyphoon.ai/v1',
  model: 'typhoon-v2-70b-instruct',
  apiKey: '',
  systemPrompt:
    'คุณคือ AI ผู้ช่วยบ้านอัจฉริยะ (Smart Home Assistant) นิสัยเป็นกันเอง ร่าเริง ชอบช่วยเหลือ ตอบคำถามด้วยภาษาที่เข้าใจง่าย สั้น กระชับ ไม่ต้องอธิบายเรื่องเทคนิค และมักจะใช้ Emoji ประกอบเสมอ',
  profile: { name: 'Mira K.', role: 'Owner' },
  skills: [
    {
      id: 'sensor_read',
      name: 'mqtt_read',
      description: 'Read the latest value from a connected sensor via MQTT topic.',
      enabled: true,
      schema: '{"type":"object","properties":{"topic":{"type":"string"}},"required":["topic"]}',
    },
    {
      id: 'mqtt_pub',
      name: 'mqtt_publish',
      description: 'Publish a raw payload to an MQTT topic to control a device.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"topic":{"type":"string"},"payload":{"type":"string"}},"required":["topic","payload"]}',
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
  accentHue: 175,
  accentChroma: 0.15,
  density: 'comfortable',
  showGrid: true,
}
