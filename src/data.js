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
  model: 'typhoon-v2-70b-instruct',
  apiKey: '',
  systemPrompt:
    'คุณคือ AI ผู้ช่วยบ้านอัจฉริยะ (Smart Home Assistant) นิสัยเป็นกันเอง ร่าเริง ชอบช่วยเหลือ ตอบคำถามด้วยภาษาที่เข้าใจง่าย สั้น กระชับ ไม่ต้องอธิบายเรื่องเทคนิค และมักจะใช้ Emoji ประกอบเสมอ',
  profile: { name: 'Mira K.' },
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
    {
      id: 'os_command',
      name: 'os_command',
      description: 'Translate a natural-language instruction into an OS terminal command and publish it via MQTT to a target computer. Use when an os_terminal device is in the device list.',
      enabled: true,
      schema:
        '{"type":"object","properties":{"instruction":{"type":"string","description":"Natural language description of what to do on the remote machine"},"os":{"type":"string","enum":["windows","mac","linux"],"description":"Target operating system"},"topic":{"type":"string","description":"MQTT pubTopic of the target os_terminal device"},"wait_output":{"type":"boolean","description":"True if the command is expected to return output (e.g. dir, ls, cat). False for fire-and-forget commands (e.g. shutdown, reboot, open app)."}},"required":["instruction","os","topic","wait_output"]}',
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
