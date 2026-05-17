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

### Frontend Agent (LangGraph Plan-and-Execute + Multi-Router)

```
ผู้ใช้ พิมพ์/พูด
       │
       ▼
  router_planner ◄─────────────────┐
       │ (พ่น plan + needs_next_round)│  loop สูงสุด 2 รอบ
       ▼                              │
   announce ──► ส่ง plan ให้ UI วาด Tool Pills (ข้ามถ้าเป็น general ล้วน)
       │                              │
       ├── needs_clarify ──► clarify ─┼────┐
       ├── all general    ──► chat   ─┼────┤
       └── มี step         ──► plan_executor (retry สูงสุด 3 ครั้ง/step)
                                    │
                                    ├── มี step fail หลัง retry หมด ──► response
                                    │
                                    ├── needs_next_round + ยังไม่ครบ max
                                    │      ──► synthesizer ──── (กลับ router_planner รอบใหม่)
                                    │
                                    └── default ──► response ──────────┤
                                                                       │
                                              memory_compressor ◄──────┘
                                                       │
                                                       ▼
                                                      END
```

**Router-Planner — วาง plan ทั้งก้อนก่อนรัน + ตัดสินใจว่าจะเรียกตัวเองอีกรอบไหม**
- LLM อ่านคำสั่ง user + Knowledge Graph + history แล้วตอบเป็น JSON ชุดเดียว: `{steps: [...], needs_next_round: bool}`
- **`needs_next_round=true`** เมื่อมี step ที่ต้องค้น/ดึงข้อมูล แล้วต้องใช้ผลไปตัดสินใจ step ถัดไป (เช่น "ดูราคา BTC ถ้าเกิน 100k เปิดไฟ" → รอบ 1 ค้น, รอบ 2 ตัดสินใจ)
- ถ้าข้อมูลไม่พอจะวาง plan → ตั้ง `need_clarify` ให้ clarify node ถามผู้ใช้
- บังคับ JSON schema ผ่าน `withStructuredOutput` กัน LLM ลืม field

**Plan-Executor — รัน step ตาม plan + retry**
- รัน step แบบ sequential ตามลำดับ
- แต่ละ step มี **retry สูงสุด 3 ครั้ง** ถ้า skill คืน `ok=false` (กัน network glitch / mqtt timeout)
- ถ้าครบ 3 ครั้งยัง fail → step ที่เหลือยังทำต่อ แต่ flag `has_failed_step` จะตัดวงจร multi-router ส่งไป response แจ้ง user แทนการเข้า synthesizer
- map `step.type` → skill ใน `src/utils/mainagent/skills/`:

  | Skill | หน้าที่ |
  |---|---|
  | `homeControl` | สั่ง MQTT ไปยัง IoT device (digital/analog) |
  | `hubControl` | ส่ง task ไปยัง Hub Agent (Python ReAct) |
  | `realtimeData` | ค้นเว็บผ่าน Serper API |
  | `manageSettings` | อ่าน/แก้ settings ผ่านภาษาธรรมชาติ |
  | `general` | ตอบคำถาม/คุยเล่นด้วย LLM โดยตรง |
  | `deviceNotFound` | จัดการเคส plan อ้างถึง device ที่ไม่อยู่ใน KG |

- callback `onStepStart` / `onStepResult` ออก UI → Tool Pill เปลี่ยนสถานะ pending → running → ok/fail แบบ real-time

**Synthesizer — Evaluator + Blindfold handoff**
- เปิดทำงานเมื่อ router-planner รอบที่แล้วบอกว่า `needs_next_round=true` และ executor ไม่มี fail
- หน้าที่: ประเมินเงื่อนไขจาก user request เทียบกับข้อมูลที่ค้นมา แล้วพ่น **"คำสั่งปฏิบัติการสั้น ๆ"** เช่น "เปิดไฟหน้าบ้าน" หรือ "เงื่อนไขไม่ตรง ไม่ต้องทำอะไร"
- คำสั่งนี้ถูก inject เป็น `HumanMessage` ส่งกลับเข้า router-planner รอบใหม่ — **โดยตัด user message เดิมทิ้ง** (Blindfold pattern)
- ผลคือ router รอบ 2 มองเห็นแต่คำสั่งตรง ๆ ไม่เห็นเรื่อง "หาข้อมูลหุ้น" เดิม → ไม่ติด tool-use bias ที่จะเลือก realtime_data ซ้ำ
- ระหว่างทำงาน ยิง `onInterimStatus("กำลังตัดสินใจขั้นถัดไป")` ให้ UI โชว์ chip คั่นระหว่าง 2 Tool Pills

**Response — สรุปผลให้ user**
- รับผลของทุก step ที่รันไปทั้งหมด (สะสมข้าม rounds) + KG ปัจจุบัน → stream คำตอบเป็นภาษาธรรมชาติ

**Memory Compressor — บีบประวัติแชท + carry-over field ก่อนจบ turn**
- ทุก path (chat / clarify / response) ผ่าน node นี้ก่อน END
- บีบประวัติสนทนาเป็น `optimizedHistory` ให้ caller (`useChat`) เก็บไว้ใช้ turn ถัดไป — กัน context window ระเบิด
- คำนวณ **carry-over fields** ส่งกลับ caller ผ่าน ref:
  - `pending_clarify` — คำถามที่ถาม user ค้างไว้ (จาก clarify node) รอ user ตอบ turn ถัดไป
  - `wait_retry` — งานที่ทำไม่สำเร็จ รอ user สั่งต่อ ("ลองอีกที" → router-planner รอบหน้าหยิบมา plan ใหม่)
  - ทั้ง 2 field reset เป็น `''` เมื่อ turn ถัดไปทำสำเร็จ หรือ clear chat

```
plan_executor ──► homeControl  ──► MQTT ──► IoT Devices (digital / analog)
              ├── hubControl   ──► MQTT ──► Hub Agent (Python)
              │                                └── ReAct loop (os_exec + web_search)
              ├── realtimeData ──► Serper API
              └── manageSettings ──► local Settings store
```

> หมายเหตุ: architecture เวอร์ชันก่อนหน้า (ReAct + Reflect + Guard) อยู่ที่ branch [`old_architecture`](../../tree/old_architecture) สำหรับอ้างอิง

