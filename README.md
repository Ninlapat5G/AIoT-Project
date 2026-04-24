# AIoT Smart Home Dashboard

ระบบควบคุมบ้านอัจฉริยะ พร้อม AI Assistant ที่สั่งงานอุปกรณ์ IoT และคอมพิวเตอร์ปลายทางผ่าน MQTT แบบ Real-time
สร้างด้วย React + Tailwind CSS + Framer Motion และ LLM ที่รองรับ OpenAI-compatible API

---

## คอนเซปต์

โปรเจคนี้เชื่อม AI เข้ากับโลก IoT จริง — ผู้ใช้**พูดหรือพิมพ์**เป็นภาษาไทย (หรืออังกฤษ) เพื่อ:

- **ควบคุมอุปกรณ์บ้าน** เช่น เปิดไฟ หรี่แสง ปิด AC
- **สั่งคอมพิวเตอร์ปลายทาง** เช่น ดูไฟล์, รีสตาร์ท, รันโปรแกรม — ผ่าน MQTT → Python agent ที่รันบนเครื่องนั้น

ทุกอย่าง BYOK (Bring Your Own Key) — ไม่มี backend, ไม่มี server, เก็บข้อมูลใน localStorage

---

## Architecture

```
ผู้ใช้พิมพ์/พูด
       │
       ▼
┌──────────────────────────────────────┐
│           Mini Agent Graph           │
│                                      │
│  [router]  temp=0.1                  │
│   วิเคราะห์คำสั่ง → เลือก tool(s)    │
│       │                              │
│       ├─ มี tool calls               │
│       │        ▼                     │
│  [tool_executor]                     │
│   mqtt_publish / mqtt_read           │
│   os_command → generateOsCommand     │
│              → MQTT publish          │
│              → รอ output 10 วิ (opt) │
│       │                              │
│       └───────────────┐              │
│                       ▼              │
│  [responder]  temp=0.7  streaming    │
│   ตอบเป็นภาษาคน + แสดง output       │
└──────────────────────────────────────┘
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
| AI / LLM | OpenAI-compatible API (ค่าเริ่มต้น: Typhoon v2 70B) |
| Agent | Mini graph engine — router → tool_executor → responder |
| Voice | Web Speech API (Chrome/Edge) |
| Storage | `localStorage` — ไม่มี backend |
| Deployment | Vercel (static site) |
| Terminal Agent | Python 3 + paho-mqtt |

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
│   ├── agent.js              # Graph engine + LLM client + generateOsCommand
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
    ├── DeviceCard.jsx        # digital / analog / os_terminal types
    ├── ChatPage.jsx          # AI Chat + Voice input + Stop button
    ├── SettingsPage.jsx      # 6 sections + JSON export/import
    └── TweaksPanel.jsx       # Live theme editor

terminal_agent.py             # Python MQTT agent รับคำสั่งแล้วรันบนเครื่องจริง
```

---

## วิธีติดตั้งและรัน

### Web App

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

### Terminal Agent (Python)

```bash
pip install paho-mqtt
python terminal_agent.py
```

แก้ `CMD_TOPIC` / `OUT_TOPIC` ใน `terminal_agent.py` ให้ตรงกับ pubTopic / subTopic ของ Terminal widget

---

## ฟีเจอร์ระบบ

### หน้า Devices

- สถานะอุปกรณ์ real-time ผ่าน MQTT
- **Digital** — toggle เปิด/ปิด
- **Analog** — slider + animated readout
- **Terminal** (os_terminal) — widget สำหรับ dev ส่ง raw command ตรงไปยัง pubTopic โดยไม่ผ่าน AI
- กด ⚙ แก้ไขชื่อ, ห้อง, ประเภท, OS, MQTT topics
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
| `ดูไฟล์ใน Desktop หน่อย` | แปลงเป็น `dir` / `ls` แล้วส่งไปคอมปลายทาง รอผลกลับมาบอก |
| `ปิดเครื่องคอมให้หน่อย` | แปลงเป็น `shutdown /s /t 0` แล้วส่ง ไม่รอ output |

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
- `mqtt_publish` — publish payload ไปยัง MQTT topic และอัพเดต device state
- `mqtt_read` — อ่านค่าล่าสุดจาก sensorCache
- `os_command` — เรียก `generateOsCommand` แปลงภาษาคน→ command จริง → publish → รอ output สูงสุด 10 วิ (เฉพาะ `wait_output: true`)

### Responder Node — ตอบผู้ใช้

- ได้ข้อมูลครบ: system prompt, ชื่อ user, สถานะบ้านปัจจุบัน, ผลลัพธ์ทุก tool
- `temperature=0.7` — ตอบแบบธรรมชาติ
- Stream คำตอบทีละ token

---

## Skills (Built-in)

| Skill | หน้าที่ | wait_output |
|---|---|---|
| `mqtt_publish` | publish payload ไปยัง device topic | — |
| `mqtt_read` | อ่านค่าล่าสุดจาก sensor topic | — |
| `os_command` | แปลงคำสั่งภาษาคน → terminal command → publish ไปคอมปลายทาง | router ตัดสินใจ |

**os_command:** router กำหนด `wait_output: true` เมื่อคำสั่งคาดว่ามี output (dir, ls, cat, ipconfig...) และ `false` สำหรับ fire-and-forget (shutdown, reboot, เปิดโปรแกรม...)

เพิ่ม custom skill ได้ที่ Settings → Section 03 — กำหนด name, description, JSON Schema ได้อิสระ

---

## Terminal Agent (Python)

`terminal_agent.py` รันบนเครื่องปลายทาง รับคำสั่งผ่าน MQTT แล้วรัน command จริง

```
Web App / AI Chat
      │  os_command
      ▼
MQTT Broker (HiveMQ)
      │  CMD_TOPIC
      ▼
terminal_agent.py
      ├─ cd /path   → os.chdir()         # อัพเดต working directory
      └─ คำสั่งอื่น → subprocess.getoutput()  # รัน + capture output
      │
      ▼ output
MQTT Broker
      │  OUT_TOPIC
      ▼
Web App แสดงผลใน Chat
```

> Web app ใช้ WebSocket (port 8884), Python ใช้ TCP (port 1883) — same broker ทำงานร่วมกันได้

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
