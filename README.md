# AIoT Smart Home Dashboard

ระบบควบคุมบ้านอัจฉริยะ พร้อม AI Assistant ที่สั่งงานอุปกรณ์ IoT ผ่าน MQTT แบบ Real-time
สร้างด้วย React + Tailwind CSS + Framer Motion และ LLM ที่รองรับ OpenAI-compatible API

---

## คอนเซปต์

โปรเจคนี้จำลองระบบ Smart Home ที่ผู้ใช้สามารถ **พูดคุยกับ AI** เป็นภาษาไทย (หรืออังกฤษ) เพื่อสั่งงานอุปกรณ์ในบ้าน
แทนที่จะต้องกดปุ่มหรือเลื่อน Slider เอง — เพียงพิมพ์ หรือกดไมค์พูดว่า _"เปิดไฟห้องนั่งเล่น"_ หรือ _"หรี่แสงลงครึ่งนึง"_
AI จะเข้าใจและส่งคำสั่งผ่าน MQTT ไปยังอุปกรณ์จริงโดยอัตโนมัติ

ทุกคนสามารถใช้งานได้ฟรี เพียงนำ API Key ของตัวเองมาใส่ใน Settings (BYOK — Bring Your Own Key)

---

## Architecture

```
ผู้ใช้พิมพ์/พูด
       │
       ▼
┌─────────────────────────────────┐
│       Mini Agent Graph          │
│                                 │
│  [router node]  temp=0.1        │
│   วิเคราะห์คำสั่ง → เลือก tool(s)│
│       │                         │
│       ├─ มี tool calls          │
│       │       ▼                 │
│  [tool_executor node]           │
│   loop: mqtt_publish/mqtt_read  │
│       │                         │
│       └──────────────┐          │
│                      ▼          │
│  [responder node]  temp=0.7     │
│   ตอบแบบ streaming             │
└─────────────────────────────────┘
       │
       ▼
Device Card อัปเดต real-time (MQTT QoS 2)
```

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI Framework | React 18 + Vite 5 |
| Styling | Tailwind CSS v3 + CSS custom properties (`oklch`) |
| Animation | Framer Motion (spring, stagger, AnimatePresence, useMotionValue) |
| IoT Protocol | MQTT over WebSocket — `mqtt.js` v5 · **QoS 2** · auto-reconnect |
| AI / LLM | OpenAI-compatible API (ค่าเริ่มต้น: Typhoon v2 70B) |
| Agent | Mini graph engine — router → tool_executor → responder |
| Voice | Web Speech API (เครื่องมือของ Google บน Chrome/Edge) |
| QR | `qrcode` (สร้าง) + `jsqr` (สแกนจากกล้อง หรือไฟล์รูปภาพ) |
| Storage | `localStorage` (ไม่มี backend, ไม่มี server) |
| Deployment | Vercel (static site) |

---

## โครงสร้างโปรเจค

```
src/
├── App.jsx                   # Root — orchestrates state, tools, QR import
├── data.js                   # ค่าเริ่มต้น (devices, settings, areas, tweaks)
├── index.css                 # Tailwind + ระบบ theme (dark/light, oklch)
├── hooks/
│   ├── useMQTT.js            # MQTT connection, publish, sensorCache, status
│   └── useChat.js            # Chat messages, agent loop, streaming
├── utils/
│   ├── agent.js              # Mini graph engine + LLM client (streaming)
│   ├── mqttTopic.js          # normalizeBase / buildFullTopic helpers
│   ├── qrshare.js            # QR payload: encode/decode/apply + pattern check
│   └── storage.js            # localStorage helpers
└── components/
    ├── ui/
    │   ├── Icon.jsx          # SVG icons (รวม mic, qr, scan, upload, image)
    │   ├── Toggle.jsx
    │   └── Slider.jsx        # Smooth animation via useMotionValue
    ├── chat/
    │   ├── ChatBubble.jsx
    │   └── ToolPill.jsx      # แสดง tool call + ผลลัพธ์
    ├── ErrorBoundary.jsx     # React Error Boundary ครอบทุก page
    ├── Nav.jsx
    ├── DeviceCard.jsx        # React.memo + topic validation
    ├── ChatPage.jsx          # AI Chat + Voice input
    ├── SettingsPage.jsx      # 6 sections
    ├── QRShareModal.jsx      # สร้าง/สแกน QR + file upload + validation popup
    └── TweaksPanel.jsx       # Live theme editor
```

---

## วิธีติดตั้งและรัน

### ความต้องการ

- Node.js >= 18
- API Key จาก [OpenTyphoon](https://opentyphoon.ai) หรือ OpenAI-compatible endpoint อื่น
- เบราว์เซอร์ **Chrome / Edge** (ถ้าต้องการใช้ Voice และ QR scan)

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
4. ไปที่หน้า **AI Chat** แล้วลองพิมพ์/กดไมค์ เช่น _"เปิดไฟห้องนั่งเล่น"_

---

## ฟีเจอร์ระบบ

### หน้า Devices

- ดูสถานะอุปกรณ์ทั้งหมดแบบ real-time ผ่าน MQTT
- **Digital device** — toggle เปิด/ปิด พร้อม optimistic UI (อัพเดตทันที ไม่รอ MQTT confirm)
- **Analog device** — slider พร้อม animated readout และ smooth transition ค่า (Framer Motion)
- กด ⚙ เพื่อแก้ไขชื่อ, ห้อง, ประเภท, max value, MQTT topic (มี validation ห้าม `#` `+`)
- กด **+ Add Device** เพื่อเพิ่มอุปกรณ์ใหม่
- กด **Edit** ที่ filter bar เพื่อจัดการห้อง
- Banner แจ้งเตือนเมื่อ MQTT กำลัง reconnect หรือเกิดข้อผิดพลาด
- Toast แจ้งเตือนเมื่อ network offline/online

### หน้า AI Chat

ตอบกลับแบบ **streaming** (เห็นคำตอบทีละตัวอักษร)

- **พิมพ์** หรือ **กดไมค์** เพื่อพูด (auto-detect ภาษาจาก browser — ไทย/อังกฤษ)
- ระหว่างฟัง → ปุ่มไมค์กระพริบสีแดงพร้อม pulse animation
- AI ทำได้ทั้งคุยเล่น (ไม่สั่ง MQTT) และสั่งงาน (หลายคำสั่งพร้อมกันได้)

| ตัวอย่างคำสั่ง | ผลลัพธ์ |
|---|---|
| `เปิดไฟห้องนั่งเล่น` | publish `true` ไปที่ lamp |
| `ปิดไฟทั้งหมดในครัว` | publish `false` ทุก lamp ในห้องครัว (หลาย tool calls) |
| `หรี่แสงลงครึ่งนึง` | คำนวณ `max/2` แล้ว publish |
| `ตอนนี้ไฟเปิดกี่ดวง` | อ่าน state จาก context แล้วตอบ (ไม่ต้อง tool) |
| `สวัสดี วันนี้ดียังไง` | คุยเล่นปกติ — ไม่เรียก tool |

### หน้า Settings

| Section | รายละเอียด |
|---|---|
| 01 Profile | ชื่อและบทบาทที่ AI ใช้ในบทสนทนา |
| 02 Language Model | Endpoint · API Key · Model · System Prompt |
| 03 Skills | เปิด/ปิด tool หรือเพิ่ม custom tool พร้อม JSON Schema |
| 04 MQTT Broker | URL · Port · Base Topic · สถานะการเชื่อมต่อจริง |
| 05 Share via QR | สร้าง/สแกน QR Code เพื่อย้าย config ข้ามเครื่อง |
| 06 Data | ปุ่ม **Clear all local data** (รีเซ็ตทุกอย่างกลับ default) |

### Share via QR

- **สร้าง QR** — เลือกเฉพาะสิ่งที่จะแชร์ (profile, LLM config, MQTT broker, skills, theme, หรือเฉพาะ device บางตัว)
- API Key เป็น opt-in มี popup ยืนยันก่อน เพราะแชร์ไปแล้วคนอื่นใช้เงินในบัญชี LLM ได้
- **สแกน QR** — เปิดกล้อง หรือ **เลือกรูปภาพจากเครื่อง** ก็ได้
- ทั้งสองช่องทางผ่านการ **validate payload ก่อนเสมอ**:
  - ถูกต้อง → popup แสดง scope ที่จะ import → กด "Import เลย" ถึงจะดำเนินการ
  - ไม่ถูกต้อง → popup แจ้งเหตุผล → กด "ลองใหม่" กล้องเปิดใหม่อัตโนมัติ
- Device ID ที่ซ้ำจะถูกข้าม (skip duplicate)
- Payload มี header `_t: "aiot-share"` เพื่อกัน QR อื่นที่ไม่เกี่ยวข้อง

### MQTT

- ใช้ **QoS 2** (exactly-once delivery) ทั้ง publish และ subscribe
- เมื่อเชื่อมต่อสำเร็จ จะ subscribe `baseTopic/#` ทันที — retained message ทำให้เห็น state ปัจจุบันทันที
- **Auto-reconnect** ทุก 5 วินาทีเมื่อ connection หลุด พร้อม banner แจ้งในหน้า Devices
- สถานะ MQTT แสดงจริงใน Nav sidebar และ Settings (CONNECTING / ONLINE / RECONNECTING / ERROR / OFFLINE)

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

## Agent ทำงานยังไง (รายละเอียด)

### 1. Router Node — ทำความเข้าใจคำสั่ง

เมื่อผู้ใช้ส่งข้อความเข้ามา router node จะ:

- ส่ง **device list ทั้งหมด** (JSON.stringify) ให้ LLM — รวมทุก field: `id`, `name`, `room`, `type`, `on`/`value`, `max`, `pubTopic`, `subTopic`, `icon`
- ส่ง **skills ที่เปิดใช้งาน** เป็น OpenAI-format tools พร้อม JSON Schema ของแต่ละ tool
- ตั้ง `temperature=0.1` เพื่อให้การตัดสินใจแม่นยำ

LLM ตัดสินใจว่า:
- **ต้องสั่งอุปกรณ์?** → คืน `tool_calls` (**1 ตัวหรือหลายตัวก็ได้**)
- **คุยเฉยๆ?** → ไม่คืน tool calls

### 2. Tool Executor Node — ทำงานจริง

- Loop ทุก tool call ตามลำดับ (มี delay 600ms ให้ UI แสดง ToolPill ทีละตัว)
- เรียก `mqtt_publish` หรือ `mqtt_read` ผ่าน MQTT broker (QoS 2)
- เก็บผลลัพธ์แต่ละตัวเข้า `toolResults[]`

### 3. Responder Node — ตอบผู้ใช้

- ได้ข้อมูลครบ: system prompt, **สถานะบ้านปัจจุบันทั้งหมด**, ผลลัพธ์ของทุก tool, ประวัติแชท
- `temperature=0.7` เพื่อให้ตอบแบบธรรมชาติ
- Stream คำตอบทีละ token

---

## ความยืดหยุ่นของ Agent

### Agent เข้าใจอุปกรณ์ได้ครบแค่ไหน?

**ครบทุก field.** Router ได้รับ device list เต็มในรูปแบบ JSON ดังนั้นมัน **มองเห็นและเข้าใจ**:

- **ชื่อเล่นแต่ละตัว** (`name: "Arc Floor Lamp"`) — ผู้ใช้พูดว่า "โคมลอย", "ไฟอาร์ค", "floor lamp" ก็ match ได้
- **ห้อง** (`room: "Living Room"`) — "ห้องนั่งเล่น", "living room", "ข้างนอก" เข้าใจได้
- **ประเภท** (`type: "digital"`/`"analog"`) — รู้ว่าอันไหน toggle อันไหน slider
- **ค่า max** (`max: 255` หรือ `1023`) — คำนวณ "ครึ่งนึง" = 127 หรือ 511 ได้ถูกต้อง
- **Topic จริง** (`pubTopic`) — ใช้ topic ที่ระบุไว้ ไม่สร้างเองมั่ว

ผู้ใช้ไม่ต้องเรียก device ด้วยชื่อเป๊ะๆ — พูดบอกทิศทาง/สภาพ ก็เดาได้ เช่น _"ปิดไฟบนเพดาน"_ → match `Ceiling Dimmer` ด้วย name

### Skills ยืดหยุ่นแค่ไหน?

Skills system เป็น **OpenAI-compatible tool definition** สมบูรณ์:

- แก้ชื่อ, description, JSON Schema ได้อิสระ
- เพิ่ม custom tool ใหม่ได้ไม่จำกัด
- เปิด/ปิดแต่ละตัวได้
- **Built-in tool 2 ตัว** ที่ backend จริงๆ รองรับ: `mqtt_publish`, `mqtt_read`
- Custom tool ที่เพิ่มเข้ามา — router เรียกได้ แต่ executor จะตอบ `Unknown tool` (ต้องแก้ `executeTool` ใน `App.jsx` เพื่อ handle tool ใหม่)

### สั่งงานได้หลาย MQTT ในคำสั่งเดียวมั้ย?

**ได้** — เพราะ tool_calls ของ OpenAI schema เป็น array

ตัวอย่างจริง:
```
User: "ปิดไฟทั้งบ้าน"
     ↓
Router LLM scan device list → เจอ digital lamp 5 ดวง
     ↓
คืน tool_calls: [
  mqtt_publish(liv-lamp/set, "false"),
  mqtt_publish(kitchen-lamp/set, "false"),
  mqtt_publish(bed-lamp/set, "false"),
  ...
]
     ↓
Tool executor loop publish ทีละตัว (600ms apart)
     ↓
Responder: "ปิดไฟทั้ง 5 ดวงให้แล้วค่า 💡"
```

**Combo command** ก็ได้:
```
User: "เปิดไฟห้องนอน หรี่แสงเป็น 30% แล้วปิด AC"
     ↓
3 tool calls ต่างประเภท (digital on, analog value, digital off)
     ↓
Responder สรุปผลให้ฟัง
```

**ข้อจำกัด:**
- ทำได้ในหนึ่ง router turn เท่านั้น (ไม่ได้เป็น multi-step agent ที่วางแผนหลายรอบ)
- ถ้าคำสั่งต้องรอผล tool ก่อนค่อยตัดสินใจ tool ถัดไป → ต้องแยกเป็นหลายข้อความ

---

## MQTT Topics (ค่าเริ่มต้น)

Broker: `wss://broker.hivemq.com:8884/mqtt` (public, ไม่ต้อง login)
Base Topic: `Mylab/smarthome`

Topic ของ device จะเป็น **suffix ต่อจาก Base Topic** เสมอ ระบบจะเชื่อมให้อัตโนมัติ
ถ้าใส่ full path (รวม Base Topic) ในช่อง topic ของ widget ระบบจะ normalize ให้ถูกต้องเองโดยอัตโนมัติ

| Device | PUB Topic (suffix) | SUB Topic (suffix) |
|---|---|---|
| Arc Floor Lamp | `living-room/liv-lamp/set` | `living-room/liv-lamp/state` |
| Ceiling Dimmer | `living-room/liv-dim/set` | `living-room/liv-dim/state` |

Full topic ที่ใช้จริง = `{Base Topic}/{suffix}` เช่น `Mylab/smarthome/living-room/liv-lamp/set`

---

## Deploy บน Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Ninlapat5G/AIoT-Project)

> ต้องใช้ `wss://` (port 8884) เมื่อ deploy บน HTTPS — broker.hivemq.com รองรับอยู่แล้ว
> Voice และ QR scan ทำงานเฉพาะบน HTTPS (Vercel ให้อัตโนมัติ) และใน Chrome/Edge

---

## License

MIT
