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
| `mqtt_publish` | ส่ง payload ไปยัง device |
| `mqtt_read` | อ่านสถานะจาก device |
| `hub` | สั่งงาน Hub Agent (ReAct loop, streams output) |
| `web_search` | ค้นหาผ่าน Serper API |
| `manage_settings` | อ่าน/แก้ไข settings ผ่านภาษาธรรมชาติ |
| `query_knowledge_graph` | ดึงสถานะ devices และ skills ที่ active ณ ขณะนั้น |

---

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 + Tailwind CSS |
| AI / Agent | LangGraph ReAct + Typhoon v2.5 |
| IoT | MQTT over WebSocket (mqtt.js) |
| Hub Agent | Python + OpenAI-compatible ReAct loop + paho-mqtt |
| Deploy | Vercel (static) |

---

## สถาปัตยกรรม

### Frontend Agent (LangGraph)

```
ผู้ใช้ พิมพ์/พูด
       │
       ▼
  LangGraph ReAct Loop
  ┌──────────────────┐
  │ agent → tools    │
  │ (loop until done)│
  └──────────────────┘
       │
       ├── mqtt_publish / mqtt_read ──► IoT Devices
       └── hub ──► MQTT ──► Hub Agent (Python)
                              └── ReAct loop
                                   ├── os_exec (stream, cancel)
                                   └── web_search (Serper)
```

