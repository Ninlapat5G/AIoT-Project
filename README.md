# SynaptaOS — Smart Home Dashboard

AI-powered smart home dashboard พูดภาษาไทย ควบคุมอุปกรณ์ผ่าน MQTT และสั่งงานคอมพิวเตอร์ remote ผ่าน Hub Agent

---

## Powered by Typhoon AI

SynaptaOS ใช้ [Typhoon v2.5 (`typhoon-v2.5-30b-a3b-instruct`)](https://opentyphoon.ai) โดย SCBX เป็น AI หลักในการสนทนาและควบคุมอุปกรณ์ — ออกแบบมาสำหรับภาษาไทย รองรับการผสม Thai-English และมี function calling ที่แม่นยำสำหรับงาน agentic

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

ไปที่หน้า **Settings → Section 02 Language Model** แล้วกรอกข้อมูลนี้:

| ค่า | ตัวอย่าง | คืออะไร |
|---|---|---|
| API Endpoint | `https://api.opentyphoon.ai/v1` | ที่อยู่ของ AI ที่ใช้ |
| API Key | รับได้จากลิงก์ด้านบน | รหัสผ่านสำหรับใช้ AI |
| Model | `typhoon-v2.5-30b-a3b-instruct` | รุ่นของ AI ที่ต้องการใช้ |

### 2. MQTT Broker (สำหรับควบคุม IoT)

**Settings → Section 05** — ค่าเริ่มต้นในระบบใช้ HiveMQ public broker ได้เลย ไม่ต้องตั้งอะไรเพิ่ม

> MQTT คือ "ช่องทางสื่อสาร" ระหว่างแอปกับอุปกรณ์ไฟฟ้าในบ้าน เปรียบเหมือนวิทยุที่ทุกอุปกรณ์รับ-ส่งสัญญาณผ่านช่องเดียวกัน

### 3. เพิ่มอุปกรณ์

ไปที่หน้า **Devices** → กด Add:

| ประเภท | ใช้กับอะไร |
|---|---|
| Add Device → digital | อุปกรณ์ที่รับ ON/OFF เช่น ไฟ ปลั๊ก รีเลย์ |
| Add Device → analog | อุปกรณ์ที่รับค่าตัวเลข เช่น หรี่แสง (dimmer) |
| Add Hub | คอมพิวเตอร์ที่ต้องการสั่งงาน remote |

---

## Hub Agent — ติดตั้งบนเครื่องที่อยากควบคุม

Hub Agent คือโปรแกรมที่รันบนเครื่องที่ต้องการควบคุม เมื่อ AI สั่งมา โปรแกรมนี้จะรับคำสั่งและทำตาม

### วิธีติดตั้ง (แบบง่าย — แนะนำ)

1. เปิดโฟลเดอร์ `hub/`
2. รัน `python hub/build_gui.py`
3. กรอก API Key, MQTT settings ใน GUI ที่เปิดขึ้นมา
4. กด **Save Settings** แล้วกด **Build .exe**
5. รอสักครู่ — จะได้ไฟล์ `hub/dist/SynaptaHubAgent.exe`
6. ย้าย `.exe` และ `.env` ในโฟลเดอร์เดียวกันไปใส่เครื่องที่ต้องการควบคุม
7. ดับเบิลคลิก `SynaptaHubAgent.exe` — เปิดทิ้งไว้

> `.env` คือไฟล์เก็บ API Key และการตั้งค่า ถ้าอยากเปลี่ยน key ในภายหลัง แก้ไฟล์นี้แล้วเปิดโปรแกรมใหม่ ไม่ต้อง build ซ้ำ

### วิธีติดตั้ง (แบบ manual — สำหรับนักพัฒนา)

1. คัดลอก `hub/.env.example` → `hub/.env` แล้วกรอกค่า
2. `pip install -r hub/requirements.txt`
3. `python hub/agent.py`

### โครงสร้างไฟล์ใน hub/

```
hub/
├── agent.py          # ตัวโปรแกรมหลัก — รับคำสั่งผ่าน MQTT
├── runner.py         # ReAct loop — วิเคราะห์และรันคำสั่งทีละขั้น
├── kg.py             # เก็บข้อมูลสถานะเครื่อง (RAM, Disk, ประวัติคำสั่ง)
├── build_gui.py      # GUI สำหรับตั้งค่าและ build เป็น .exe
├── tools/
│   ├── os_exec.py    # รัน command บนเครื่อง
│   ├── web_search.py # ค้นเว็บ
│   └── query_kg.py   # อ่านสถานะเครื่อง
└── .env              # การตั้งค่า (API Key, MQTT)
```

เพิ่ม tool ใหม่: สร้าง `tools/<name>.py` แล้วเพิ่มใน `tools/__init__.py` — เสร็จ

---

## Skills (ความสามารถของ AI)

| Skill | ทำอะไร |
|---|---|
| `mqtt_publish` | ส่งคำสั่งไปยังอุปกรณ์ในบ้าน |
| `hub` | สั่งงาน Hub Agent บนเครื่อง remote |
| `web_search` | ค้นหาข้อมูลจากอินเทอร์เน็ต |
| `manage_settings` | อ่าน/แก้ไข settings ผ่านภาษาธรรมชาติ |

---

## Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 18 + Vite 5 + Tailwind CSS |
| AI / Agent | LangGraph Plan-and-Execute + Typhoon v2.5 |
| IoT | MQTT over WebSocket (mqtt.js) |
| Hub Agent | Python + ReAct loop + paho-mqtt |
| Deploy | Vercel (static) |

---

## สถาปัตยกรรม

### ภาพรวม — ต่อ 1 ข้อความของ user

```
useChat.js  ──►  runAgent()  ──►  LangGraph StateGraph  ──►  ตอบกลับ + บันทึกความจำ
```

ทุก turn ที่ user พิมพ์ข้อความ ระบบจะรัน graph นี้ตั้งแต่ต้นจนจบ แล้วส่งผลกลับ

---

### ขั้นตอนใน LangGraph

```
START
  │
  ▼
[router_planner]         ← วางแผนว่าจะทำอะไร
  │
  ├─ ถามก่อน    ──► [clarify]       ─────────────────────────────────┐
  ├─ คุยทั่วไป  ──► [chat]          ─────────────────────────────────┤
  └─ มีงานต้องทำ ──► [plan_executor] ─ รันทีละ step                   │
                            │                                         │
                            ├─ step ล้มเหลว ──► [response] ──────────┤
                            │                                         │
                            └─ มีเงื่อนไขรอเช็ค ──► [evaluator]      │
                                         │                            │
                                         ├─ เงื่อนไขไม่เข้า ──► [response] ─┤
                                         └─ เงื่อนไขเข้า ──► [plan_executor] (วนได้สูงสุด 3 รอบ)
                                                                             │
                                                               [response] ───┘
                                                                    │
                                                         [memory_compressor]
                                                                    │
                                                                   END
```

---

### แต่ละ Node ทำอะไร

**`router_planner` — สมองหลัก วางแผนทั้งหมดก่อนลงมือทำ**

รับ: ข้อความ user + สถานะอุปกรณ์ทั้งบ้าน + ความจำจาก turn ก่อนหน้า
ออก: แผน JSON บอกว่าต้องทำ step อะไรบ้าง

ตัวอย่าง:
- "เปิดไฟห้องนั่งเล่น" → plan ส่ง MQTT ไปเปิดไฟ
- "ถ้า BTC เกิน 100k เปิดไฟ" → plan ค้นราคาก่อน แล้วบอกว่า "รอผลค้นก่อนตัดสินใจ"
- "สวัสดี" → ไปคุยทั่วไป ไม่ต้องทำอะไร

ถ้า LLM ตอบ JSON ผิด format → fallback เป็น general step อัตโนมัติ โดยไม่ crash

---

**`plan_executor` — ลงมือทำตาม plan ทีละ step**

รัน step ตามลำดับ แต่ละ step เรียก skill ที่เหมาะสม:

| Skill | ทำอะไร |
|---|---|
| `home_control` | ส่ง MQTT ไปเปิด/ปิด/ปรับอุปกรณ์ |
| `hub_control` | ส่งงานไปให้ Hub Agent บนเครื่อง remote |
| `realtime_data` | ค้นหาข้อมูล real-time จากอินเทอร์เน็ต (Serper) |
| `settings` | อ่านหรือเปลี่ยน settings ผ่านภาษาธรรมชาติ |
| `device_not_found` | แจ้ง user ว่าอุปกรณ์ที่พูดถึงไม่มีในระบบ |

Tool Pill จะอัปเดตสถานะแบบ real-time: pending → กำลังทำ → สำเร็จ/ล้มเหลว

---

**`evaluator` — เช็คเงื่อนไขหลังได้ข้อมูลมาแล้ว**

ใช้เมื่อ user สั่งแบบมีเงื่อนไข เช่น "ถ้า BTC เกิน 100k เปิดไฟ"

รอบ 1: router ค้นราคา BTC → ได้ผลว่า $115k
รอบ 2: evaluator เช็คว่า 115k > 100k → เงื่อนไขเข้า → สั่งเปิดไฟ

รองรับเงื่อนไขซ้อนหลายชั้น และวนได้สูงสุด 3 รอบต่อ turn
ระหว่างที่ evaluator กำลังตัดสินใจ — UI จะแสดง bubble "กำลังคิด" ให้ user เห็นว่าระบบยังทำงานอยู่

---

**`chat` — ตอบบทสนทนาทั่วไป**

ใช้เมื่อ user ทักทาย ถามความรู้ หรือต้องการข้อมูลเพิ่มก่อนทำงาน — stream คำตอบตามบุคลิกที่ตั้งค่าไว้

---

**`clarify` — ถาม user ก่อนที่จะทำงาน**

ใช้เมื่อข้อมูลไม่ครบ เช่น user บอกว่า "เปิดแอร์" แต่ไม่ได้บอกอุณหภูมิ — node นี้จะถามกลับว่า "จะให้ตั้งกี่องศาดีคะ?"

---

**`response` — รายงานผลให้ user ฟัง**

หลังทุก step เสร็จ node นี้จะ stream สรุปผลเป็นภาษาธรรมชาติ เช่น "เปิดไฟห้องนั่งเล่นให้แล้วค่ะ" — อ่านจากผลสะสมของทุก step จริงๆ ห้ามแต่งขึ้นมาเอง

---

**`memory_compressor` — บีบความจำก่อนจบ turn**

ทุก turn จะจบที่ node นี้เสมอ ทำหน้าที่บีบประวัติบทสนทนาลงเป็น 3 กระเป๋าเล็กๆ เพื่อส่งต่อไปใช้ใน turn ถัดไป:

| กระเป๋า | เก็บอะไร | ทำไมต้องเก็บ |
|---|---|---|
| `chat_summary` | สรุปบทสนทนาทั่วไป | ให้ AI "จำ" เรื่องที่คุยไว้ก่อนหน้า |
| `last_command` | คำสั่งอุปกรณ์ล่าสุด | ให้ "ปิดเลย" / "อันนั้น" ใช้ได้โดยไม่ต้องระบุซ้ำ |
| `pending_answer` | สิ่งที่ยังรอ user ตอบ | ถ้าถามไปรอบที่แล้ว จะรู้ว่ากำลังรออะไรอยู่ |

กระเป๋าเหล่านี้ใช้แทน history ยาวๆ ประหยัด context และทำให้ AI ไม่สับสน

ถ้า LLM ตอน compress เกิด error — ค่า `pending_answer` จะถูกเก็บจากรอบก่อนหน้าไว้ก่อน ไม่ถูกลบทิ้ง เพื่อไม่ให้ AI ลืม context ที่ค้างอยู่

---

### UI — สิ่งที่ user เห็นระหว่าง AI ทำงาน

| ช่วงเวลา | UI แสดง |
|---|---|
| ส่งข้อความแล้ว รอ router วางแผน | bubble "กำลังคิด" |
| router วางแผนเสร็จ step กำลังรัน | Tool Pill แสดงสถานะแต่ละ step |
| step ทุกอันเสร็จ รอ response stream | bubble "กำลังคิด" |
| evaluator กำลังตัดสินใจ | bubble พร้อม text บอกว่ากำลังตัดสินใจอะไร |
| response เริ่ม stream | bubble หายไป ข้อความ AI ปรากฏทีละคำ |

---

### การไหลของข้อมูล (Skills)

```
plan_executor ──► home_control  ──► MQTT ──► IoT Devices (ไฟ/แอร์/พัดลม ฯลฯ)
              ├── hub_control   ──► MQTT ──► Hub Agent (Python)
              │                                └── ReAct loop (รัน command + web search)
              ├── realtime_data ──► Serper API (ค้นเว็บ)
              └── settings      ──► Settings store (local)
```

> หมายเหตุ: architecture เวอร์ชันก่อนหน้า (ReAct + Reflect + Guard) อยู่ที่ branch [`old_architecture`](../../tree/old_architecture) สำหรับอ้างอิง
