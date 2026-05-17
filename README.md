# SynaptaOS — Smart Home Dashboard

AI-powered smart home dashboard พูดภาษาไทย ควบคุมอุปกรณ์ผ่าน MQTT และสั่งงานคอมพิวเตอร์ remote ผ่าน Hub Agent

---

## Powered by Typhoon AI

SynaptaOS ใช้ [Typhoon v2.5](https://opentyphoon.ai) โดย SCBX เป็น AI หลักในการสนทนาและควบคุมอุปกรณ์ — ออกแบบมาสำหรับภาษาไทย รองรับการผสม Thai-English และมี function calling ที่แม่นยำสำหรับงาน agentic

> รับ API Key ฟรีได้ที่: [playground.opentyphoon.ai/settings/api-key](https://playground.opentyphoon.ai/settings/api-key)

---

## ฟีเจอร์

- **AI Chat ภาษาไทย** — สั่งงานด้วยภาษาธรรมชาติ รองรับ Voice Input (Chrome/Edge)
- **ควบคุม IoT ผ่าน MQTT** — เปิด/ปิด/หรี่แสง/ล็อก ฯลฯ แบบ real-time
- **Hub Agent** — สั่งงานคอมพิวเตอร์ remote ด้วย AI (ReAct loop + Safety + Web Search)
- **หลาย Device Type** — digital / analog / hub รวมในที่เดียว
- **Web Search** — AI ค้นหาข้อมูลผ่าน Serper API ได้
- **Zero Backend** — ทุกอย่างรันในเบราว์เซอร์ ฝาก Vercel ได้เลย

---

## วิธีตั้งค่า

### 1. API Key (จำเป็น)

ไปที่หน้า **Settings → Section 02 Language Model**:

| ค่า | ตัวอย่าง |
|---|---|
| API Endpoint | `https://api.opentyphoon.ai/v1` |
| API Key | รับได้จากลิงก์ด้านบน |
| Model | `typhoon-v2.5-30b-a3b-instruct` |

### 2. MQTT Broker

**Settings → Section 05** — ค่าเริ่มต้นใช้ HiveMQ public broker ได้เลย ไม่ต้องตั้งอะไรเพิ่ม

### 3. เพิ่มอุปกรณ์

ไปที่หน้า **Devices** → กด Add:

| ประเภท | Device Type | หน้าที่ |
|---|---|---|
| Add Device | digital / analog | อุปกรณ์ IoT ทั่วไป |
| Add Hub | hub | คอมพิวเตอร์ remote (ReAct Agent) |

---

## Hub Agent — ติดตั้งบนเครื่อง remote

Hub Agent คือโปรแกรม Python ที่รันบนเครื่องที่ต้องการควบคุม:

1. คัดลอก `hub/.env.example` → `hub/.env` แล้วกรอกค่า
2. `pip install -r hub/requirements.txt`
3. `python hub/agent.py`
4. เพิ่ม Hub device ใน Devices ให้ MQTT topics ตรงกับ `.env`

Hub Agent จะ: รับ task → ReAct loop (รัน command → ดู output → ตัดสินใจต่อ จนเสร็จ) → ส่งผลกลับ

**โครงสร้าง hub/**
```
hub/
├── agent.py       # MQTT loop
├── runner.py      # ReAct loop
├── tools/
│   ├── os_exec.py    # รัน command (รองรับ cd, streaming, cancel)
│   └── web_search.py # ค้นเว็บ
└── .env
```

เพิ่ม tool ใหม่: สร้าง `tools/<name>.py` แล้วเพิ่มใน `tools/__init__.py` — เสร็จ

---

## Skills

| Skill | หน้าที่ |
|---|---|
| `mqtt_publish` | ส่ง payload ไปยัง device (สถานะ device อ่านจาก KG ที่ sync กับ MQTT state topic อยู่แล้ว) |
| `hub` | สั่งงาน Hub Agent (ReAct loop, streams output) |
| `web_search` | ค้นหาผ่าน Serper API |
| `manage_settings` | อ่าน/แก้ไข settings ผ่านภาษาธรรมชาติ |
| `query_knowledge_graph` | ดึงสถานะ devices และ skills ที่ active ณ ขณะนั้น |

---

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 + Tailwind CSS |
| AI / Agent | LangGraph Plan-and-Execute + Typhoon v2.5 |
| IoT | MQTT over WebSocket (mqtt.js) |
| Hub Agent | Python + OpenAI-compatible ReAct loop + paho-mqtt |
| Deploy | Vercel (static) |

---

## สถาปัตยกรรม

### Frontend Agent (LangGraph Plan-and-Execute)

```
ผู้ใช้ พิมพ์/พูด
       │
       ▼
  router_planner ──► สร้าง plan ทั้งก้อนเป็น JSON ตั้งแต่ต้น
       │             {steps: [{type, ...args}, ...]}
       │             หรือ {need_clarify: true, question: "..."}
       ▼
   announce ──► ส่ง plan ให้ UI วาด Tool Pills (ข้ามถ้าเป็น general ล้วน)
       │
       ├── needs_clarify ──► clarify ──┐
       │                                │
       ├── steps ทั้งหมดเป็น general ──► chat ──┤
       │                                │
       └── มี step ที่ต้อง execute ──► plan_executor ──► response ──┤
                                       (รัน skill ทีละ step,                │
                                        ส่ง onStepStart/onStepResult)       │
                                                                            │
                                memory_compressor ◄─────────────────────────┘
                                       │
                                       ▼
                                      END
```

**Router-Planner — วาง plan ทั้งก้อนก่อนรัน**
- LLM อ่านคำสั่ง user + Knowledge Graph + history แล้วตอบเป็น JSON ชุดเดียวว่าจะทำกี่ step ใช้ skill ไหน args อะไรบ้าง
- ต่างจาก ReAct ที่ต้องคิดทีละ step เรียก tool แล้วค่อยคิดต่อ — plan-first ลดจำนวนรอบ LLM ลงเหลือ ~2 (planner + responder) และ UI เห็นแผนทั้งหมดก่อน execute
- ถ้าข้อมูลไม่พอ → ตั้ง `need_clarify` ให้ clarify node ถามผู้ใช้

**Plan-Executor — รัน step ตาม plan**
- รัน step แบบ sequential ตามลำดับใน plan
- แต่ละ `step.type` map ไปยัง skill ใน `src/utils/mainagent/skills/`:

  | Skill | หน้าที่ |
  |---|---|
  | `homeControl` | สั่ง MQTT ไปยัง IoT device (digital/analog) |
  | `hubControl` | ส่ง task ไปยัง Hub Agent (Python ReAct) |
  | `realtimeData` | ค้นเว็บผ่าน Serper API |
  | `manageSettings` | อ่าน/แก้ settings ผ่านภาษาธรรมชาติ |
  | `general` | ตอบคำถาม/คุยเล่นด้วย LLM โดยตรง |
  | `deviceNotFound` | จัดการเคส plan อ้างถึง device ที่ไม่อยู่ใน KG |

- แต่ละ step ส่ง callback `onStepStart` / `onStepResult` ออก UI → Tool Pill เปลี่ยนสถานะ pending → running → ok/fail แบบ real-time

**Response — สรุปผลให้ user**
- รับผลของทุก step ที่รันไป + KG ปัจจุบัน → stream คำตอบเป็นภาษาธรรมชาติให้ user

**Memory Compressor — บีบประวัติแชทก่อนจบ turn**
- ทุก path (chat / clarify / response) ผ่าน node นี้ก่อน END
- สรุปประวัติทั้งหมดให้สั้นลง คืนเป็น `optimizedHistory` ให้ caller (`useChat`) เก็บไว้ใช้ turn ถัดไป
- กัน context window ระเบิดเมื่อสนทนายาว ๆ โดยไม่ทิ้งใจความสำคัญ

```
plan_executor ──► homeControl  ──► MQTT ──► IoT Devices (digital / analog)
              ├── hubControl   ──► MQTT ──► Hub Agent (Python)
              │                                └── ReAct loop (os_exec + web_search)
              ├── realtimeData ──► Serper API
              └── manageSettings ──► local Settings store
```

> หมายเหตุ: architecture เวอร์ชันก่อนหน้า (ReAct + Reflect + Guard) อยู่ที่ branch [`old_architecture`](../../tree/old_architecture) สำหรับอ้างอิง

