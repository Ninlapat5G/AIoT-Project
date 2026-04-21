# AIoT Smart Home Dashboard

ระบบควบคุมบ้านอัจฉริยะ พร้อม AI Assistant ที่สั่งงานอุปกรณ์ IoT ผ่าน MQTT แบบ Real-time
สร้างด้วย React + Tailwind CSS + Framer Motion และ LLM ที่รองรับ OpenAI-compatible API

---

## คอนเซปต์

โปรเจคนี้จำลองระบบ Smart Home ที่ผู้ใช้สามารถ **พูดคุยกับ AI** เป็นภาษาไทยเพื่อสั่งงานอุปกรณ์ในบ้าน
แทนที่จะต้องกดปุ่มหรือเลื่อน Slider เอง — เพียงพิมพ์ว่า _"เปิดไฟห้องนั่งเล่น"_ หรือ _"หรี่แสงลงครึ่งนึง"_
AI จะเข้าใจและส่งคำสั่งผ่าน MQTT ไปยังอุปกรณ์จริงโดยอัตโนมัติ

ทุกคนสามารถใช้งานได้ฟรี เพียงนำ API Key ของตัวเองมาใส่ใน Settings (BYOK — Bring Your Own Key)

---

## Architecture

```
ผู้ใช้พิมพ์คำสั่ง
       │
       ▼
┌─────────────────────────────────┐
│       Mini Agent Graph          │
│                                 │
│  [router node]  temp=0.1        │
│   วิเคราะห์คำสั่ง → เลือก tool  │
│       │                         │
│       ├─ มี tool call           │
│       │       ▼                 │
│  [tool_executor node]           │
│   mqtt_publish / mqtt_read      │
│       │                         │
│       └──────────────┐          │
│                      ▼          │
│  [responder node]  temp=0.7     │
│   ตอบภาษาไทย แบบ streaming     │
└─────────────────────────────────┘
       │
       ▼
แสดงคำตอบแบบ streaming + Device Card อัปเดต real-time (MQTT QoS 2)
```

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI Framework | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (`oklch`) |
| Animation | Framer Motion (spring, stagger, AnimatePresence) |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · **QoS 2** |
| AI / LLM | OpenAI-compatible API (ค่าเริ่มต้น: Typhoon v2 70B) |
| Agent | Mini graph engine — router → tool_executor → responder |
| Storage | `localStorage` (ไม่มี backend, ไม่มี server) |
| Deployment | Vercel (static site) |

---

## โครงสร้างโปรเจค

```
src/
├── App.jsx                   # Root — state, MQTT, agent loop, streaming
├── data.js                   # ค่าเริ่มต้น (devices, settings, areas)
├── index.css                 # Tailwind + ระบบ theme (dark/light, oklch)
├── utils/
│   ├── agent.js              # Mini graph engine + LLM client (streaming)
│   └── storage.js            # localStorage helpers (settings/devices/areas)
└── components/
    ├── ui/
    │   ├── Icon.jsx           # SVG icons
    │   ├── Toggle.jsx         # Toggle พร้อม spring animation
    │   └── Slider.jsx         # Slider 0–max พร้อม drag (รองรับ 255/1023)
    ├── chat/
    │   ├── ChatBubble.jsx     # Message bubble
    │   └── ToolPill.jsx       # แสดง tool call + ผลลัพธ์ พร้อม live indicator
    ├── Nav.jsx                # Sidebar + mobile drawer + MQTT status จริง
    ├── DeviceCard.jsx         # Card ควบคุมอุปกรณ์ (digital/analog + animated readout)
    ├── ChatPage.jsx           # หน้า AI Chat
    ├── SettingsPage.jsx       # หน้า Settings (5 sections)
    └── TweaksPanel.jsx        # Live theme editor
```

---

## วิธีติดตั้งและรัน

### ความต้องการ

- Node.js >= 18
- API Key จาก [OpenTyphoon](https://opentyphoon.ai) หรือ OpenAI-compatible endpoint อื่น

### รันในเครื่อง

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

### ตั้งค่าครั้งแรก

1. เปิดแอป → ไปที่หน้า **Settings**
2. กรอก **API Endpoint**, **API Key**, **Model**
3. กด **Save configuration** — ข้อมูลบันทึกใน `localStorage`
4. ไปที่หน้า **AI Chat** แล้วลองพิมพ์ เช่น _"เปิดไฟห้องนั่งเล่น"_

---

## ฟีเจอร์ระบบ

### หน้า Devices

- ดูสถานะอุปกรณ์ทั้งหมดแบบ real-time ผ่าน MQTT
- **Digital device** — toggle เปิด/ปิด
- **Analog device** — slider พร้อม animated readout (รองรับ max 255 หรือ 1023 สำหรับ ESP32/Arduino)
- กด ⚙ เพื่อแก้ไขชื่อ, ห้อง, ประเภท, max value, MQTT topic
- กด **+ Add Device** เพื่อเพิ่มอุปกรณ์ใหม่
- กด **Edit** ที่ filter bar เพื่อจัดการห้อง

### หน้า AI Chat

ตอบกลับแบบ **streaming** (เห็นคำตอบทีละตัวอักษร)

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | publish `true` ไปที่ topic ของ lamp |
| `ปิดไฟทั้งหมด` | publish `false` ทุก digital device |
| `หรี่แสงลงครึ่งนึง` | publish `128` ไปที่ dimmer |
| `ไฟเปิดอยู่ไหม` | อ่านสถานะจาก sensor cache แล้วตอบ |

### หน้า Settings

| Section | รายละเอียด |
|---|---|
| 01 Profile | ชื่อและบทบาทที่ AI ใช้ในบทสนทนา |
| 02 Language Model | Endpoint · API Key · Model · System Prompt |
| 03 Skills | เปิด/ปิด tool หรือเพิ่ม custom tool |
| 04 MQTT Broker | URL · Port · Base Topic · สถานะการเชื่อมต่อจริง |
| 05 Data | ปุ่ม **Clear all local data** (รีเซ็ตทุกอย่างกลับ default) |

### MQTT

- ใช้ **QoS 2** (exactly-once delivery) ทั้ง publish และ subscribe
- เมื่อเชื่อมต่อสำเร็จ จะ subscribe `baseTopic/#` ทันที — ถ้าอุปกรณ์ส่ง retained message ไว้ สถานะปัจจุบันจะอัปเดตอัตโนมัติ
- สถานะ MQTT แสดงจริงใน Nav sidebar และ Settings (CONNECTING / ONLINE / ERROR / OFFLINE)

### Tweaks Panel (ไอคอน ✦)

- Dark / Light mode
- Accent Hue (0–360°) · Chroma
- Density (compact / comfortable)
- Grid overlay

### Storage

ข้อมูลทั้งหมดเก็บใน **`localStorage`** ของเบราว์เซอร์ ไม่ผ่าน server

| Key | เก็บอะไร |
|---|---|
| `sh_settings` | endpoint, apiKey, model, systemPrompt, profile, skills, mqtt |
| `sh_devices` | รายการอุปกรณ์ทั้งหมด พร้อม state และ MQTT topics |
| `sh_areas` | รายการห้องที่กำหนดเอง |

---

## MQTT Topics (ค่าเริ่มต้น)

Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
Base Topic: `Mylab/smarthome`

| Topic | ทิศทาง | ความหมาย |
|---|---|---|
| `Mylab/smarthome/living-room/liv-lamp/set` | Publish | สั่งเปิด/ปิด (`true`/`false`) |
| `Mylab/smarthome/living-room/liv-lamp/state` | Subscribe | รับสถานะจากอุปกรณ์ |
| `Mylab/smarthome/living-room/liv-dim/set` | Publish | สั่ง dimmer (`0`–`255`) |
| `Mylab/smarthome/living-room/liv-dim/state` | Subscribe | รับค่า dimmer ปัจจุบัน |

---

## Deploy บน Vercel

```bash
# clone แล้ว deploy ได้เลย
```

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Ninlapat5G/AIoT-Project)

> ต้องใช้ `wss://` (port 8884) เมื่อ deploy บน HTTPS — broker.hivemq.com รองรับอยู่แล้ว

---

## License

MIT
