# AIoT Smart Home Dashboard

ระบบควบคุมบ้านอัจฉริยะ พร้อม AI Assistant ที่สั่งงานอุปกรณ์ IoT ผ่าน MQTT แบบ Real-time
สร้างด้วย React + Tailwind CSS + Framer Motion และ LLM ที่รองรับ OpenAI-compatible API

---

## คอนเซปต์

โปรเจคนี้เชื่อม AI เข้ากับโลก IoT จริง — ผู้ใช้**พูดหรือพิมพ์**เป็นภาษาไทย (หรืออังกฤษ) เพื่อควบคุมอุปกรณ์บ้าน เช่น เปิดไฟ หรี่แสง ปิด AC โดยไม่ต้องกดปุ่มหรือเลื่อน slider เอง

ทุกอย่าง BYOK (Bring Your Own Key) — ไม่มี backend, ไม่มี server, เก็บข้อมูลใน localStorage

---

## Architecture

```
ผู้ใช้พิมพ์/พูด
       │
       ▼
┌─────────────────────────────────┐
│       Mini Agent Graph          │
│                                 │
│  [router]  temp=0.1             │
│   วิเคราะห์คำสั่ง → เลือก tool  │
│       │                         │
│       ├─ มี tool calls          │
│       │        ▼                │
│  [tool_executor]                │
│   รัน skill ตาม tool calls      │
│       │                         │
│       └──────────────┐          │
│                      ▼          │
│  [responder]  temp=0.7          │
│   ตอบเป็นภาษาคน  streaming     │
└─────────────────────────────────┘
       │
       ▼
Device Cards อัปเดต real-time (MQTT QoS 2)
```

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI Framework | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (`oklch`) |
| Animation | Framer Motion (spring, stagger, AnimatePresence, useMotionValue) |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · **QoS 2** · auto-reconnect |
| AI / LLM | OpenAI-compatible API (ค่าเริ่มต้น: Typhoon 2.5 · 30B MoE · รองรับ tool calling) |
| Agent | Mini graph engine — router → tool_executor → responder |
| Voice | Web Speech API (Chrome/Edge) |
| Storage | `localStorage` — ไม่มี backend |
| Deployment | Vercel (static site) |

---

## โครงสร้างโปรเจค

```
src/
├── App.jsx                   # Root — orchestrates state, MQTT, tools
├── data.js                   # ค่าเริ่มต้น (devices, settings, areas, tweaks)
├── index.css                 # Tailwind + ระบบ theme (dark/light, oklch)
├── hooks/
│   ├── useMQTT.js            # MQTT connection, publish, sensorCache, waitForMessage
│   └── useChat.js            # Chat messages, agent loop, streaming, history limit
├── utils/
│   ├── agent.js              # Graph engine + LLM client + os command generator
│   ├── agentSkills.js        # Skill handlers (mqtt_publish, mqtt_read, os_command)
│   ├── mqttTopic.js          # normalizeBase / buildFullTopic helpers
│   └── storage.js            # localStorage helpers
└── components/
    ├── ui/
    │   ├── Icon.jsx
    │   ├── Toggle.jsx
    │   └── Slider.jsx
    ├── chat/
    │   ├── ChatBubble.jsx
    │   └── ToolPill.jsx
    ├── ErrorBoundary.jsx
    ├── Nav.jsx
    ├── DeviceCard.jsx        # digital / analog / os_terminal device types
    ├── ChatPage.jsx          # AI Chat + Voice input + Stop button
    ├── SettingsPage.jsx      # 6 sections + JSON export/import
    └── TweaksPanel.jsx       # Live theme editor
```

---

## วิธีติดตั้งและรัน

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

### ตั้งค่าครั้งแรก

1. เปิดแอป → ไปที่หน้า **Settings**
2. กรอก **API Endpoint**, **API Key**, **Model**
3. กด **Save configuration**
4. ไปที่หน้า **AI Chat** แล้วลองพิมพ์ เช่น _"เปิดไฟห้องนั่งเล่น"_

---

## ฟีเจอร์ระบบ

### หน้า Devices

- สถานะอุปกรณ์ real-time ผ่าน MQTT
- **Digital** — toggle เปิด/ปิด
- **Analog** — slider + animated readout
- **Terminal** — widget ส่ง raw MQTT command โดยตรง สำหรับ dev
- กด ⚙ เพื่อแก้ไขชื่อ, ห้อง, ประเภท, MQTT topics
- กด **+ Add Device** / **+ Add Terminal** เพื่อเพิ่มใหม่
- Banner แจ้งเตือนเมื่อ MQTT reconnecting / error

### หน้า AI Chat

ตอบกลับแบบ **streaming** — เห็นคำตอบทีละตัวอักษร

- พิมพ์หรือกดไมค์พูด (ภาษาไทย/อังกฤษ)
- ปุ่มหยุดระหว่าง AI กำลังคิดหรือรัน tool
- เก็บประวัติแชท **10 ข้อความล่าสุด** เพื่อประหยัด token

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | publish `true` ไปที่ lamp |
| `หรี่แสงลงครึ่งนึง` | คำนวณ `max/2` แล้ว publish |
| `ปิดไฟทั้งบ้าน` | หลาย tool calls ในคำสั่งเดียว |
| `ตอนนี้ไฟเปิดกี่ดวง` | อ่าน state จาก context ตอบทันที ไม่เรียก tool |

### หน้า Settings

| Section | รายละเอียด |
|---|---|
| 01 Profile | ชื่อที่ AI ใช้เรียกในบทสนทนา |
| 02 Language Model | Endpoint · API Key · Model · System Prompt |
| 03 Skills | เปิด/ปิด tool หรือเพิ่ม custom tool พร้อม JSON Schema |
| 04 MQTT Broker | URL · Port · Base Topic · สถานะการเชื่อมต่อ |
| 05 Share Configuration | Copy/Paste JSON เพื่อย้าย config ข้ามเครื่อง |
| 06 Data | ปุ่ม Clear all local data |

---

## Agent ทำงานยังไง

### Router Node — ตัดสินใจ

- ได้รับ device list ทั้งหมด (JSON) + skills ที่เปิดใช้งาน
- `temperature=0.1` เพื่อความแม่นยำ
- คืน `tool_calls[]` หรือ `"NO_TOOL_NEEDED"` เท่านั้น — ไม่มีคำพูดภาษาคน

### Tool Executor Node — รันจริง

- Loop ทุก tool call ตามลำดับ (delay 600ms ให้ UI แสดง ToolPill)
- logic แต่ละ skill อยู่ใน `agentSkills.js` แยกต่างหาก — เพิ่ม skill ใหม่ไม่ต้องแตะ App.jsx

### Responder Node — ตอบผู้ใช้

- ได้ข้อมูลครบ: system prompt, ชื่อ user, สถานะบ้านปัจจุบัน, ผลลัพธ์ทุก tool
- `temperature=0.7` — ตอบแบบธรรมชาติ
- Stream คำตอบทีละ token

---

## Skills (Built-in)

| Skill | หน้าที่ |
|---|---|
| `mqtt_publish` | publish payload ไปยัง device topic |
| `mqtt_read` | อ่านค่าล่าสุดจาก sensor topic |
| `os_command` | แปลภาษาคนเป็น terminal command แล้วส่งไปยัง os_terminal device |

เพิ่ม custom skill ได้ที่ Settings → Section 03 — กำหนด name, description, JSON Schema ได้อิสระ

---

## MQTT Topics (ค่าเริ่มต้น)

Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
Base Topic: `Mylab/smarthome`

Full topic = `{Base Topic}/{suffix}` — ระบบ normalize ให้อัตโนมัติ ไม่ต้องพิมพ์ซ้ำ

---

## Deploy บน Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Ninlapat5G/AIoT-Project)

> ต้องใช้ `wss://` (port 8884) เมื่อ deploy บน HTTPS — broker.hivemq.com รองรับอยู่แล้ว
> Voice input ทำงานเฉพาะบน HTTPS และใน Chrome/Edge

---

## License

MIT
