# SynaptaNode

ESP32 Arduino library for the [Synapta](https://github.com/Ninlapat5G) smart home system.

Connect an ESP32 as a **node** — it receives commands from the Synapta Web AI directly via MQTT, controls physical hardware, and reports state back.

---

## How it fits in the system

```
Web AI (browser)
     │  mqtt_publish("bedroom/bedroom-lamp/set", "true")
     ▼
MQTT Broker
     │  subscribe → set topic
     ▼
ESP32 + SynaptaNode
     │  publish("bedroom/bedroom-lamp/state", "true", retain=true)
     ▼
MQTT Broker → Web App updates UI
```

The Web AI talks directly to the ESP32. No hub required for device control.

---

## Installation

1. Install dependencies via **Arduino Library Manager**:
   - `PubSubClient` by Nick O'Leary

2. Copy the `SynaptaNode` folder into your Arduino `libraries/` directory.

3. In your sketch: `#include <Synapta.h>`

---

## Quick Start

```cpp
#include <Synapta.h>

SynaptaDigital relay("bedroom/relay");

void setup() {
    Serial.begin(115200);

    Synapta.wifi("MyWiFi", "MyPassword");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();
}

void loop() {
    Synapta.loop();
}
```

Pin assignment: เปิด Web App → Edit device → ใส่ Pin → Save

Web App ค้นพบ device อัตโนมัติผ่าน manifest topic — ไม่ต้องกรอก pubTopic/subTopic เอง

---

## API Reference

### `Synapta` (global singleton)

| Method | Description |
|--------|-------------|
| `wifi(ssid, pass)` | ตั้ง WiFi credentials |
| `baseTopic(base)` | ตั้ง base topic (ต้องตรงกับ Web App) |
| `broker(host, port, tls)` | เปลี่ยน broker (default: `broker.hivemq.com`, 8883, TLS) |
| `mqttAuth(user, pass)` | ถ้า broker ต้องการ auth |
| `nodeId(id)` | ตั้งชื่อ node เอง (default: derive จาก MAC) |
| `start()` | เริ่มจริง — เชื่อม WiFi + MQTT |
| `configure(ssid, pass, base)` | บันทึก credential ลง NVS + start ครั้งเดียว |
| `begin()` | โหลด credential จาก NVS แล้ว start |
| `loop()` | เรียกใน `loop()` ทุกครั้ง |
| `isConnected()` | คืน `true` เมื่อ MQTT พร้อมใช้ |
| `onConnect(cb)` | callback ตอน MQTT เชื่อมสำเร็จ |
| `onDisconnect(cb)` | callback ตอนหลุดการเชื่อมต่อ |

---

### Type-safe device wrappers

```cpp
SynaptaDigital relay ("bedroom/relay");
SynaptaAnalog  dimmer("bedroom/dimmer");
SynaptaSensor  temp  ("bedroom/temp");
```

`topic` คือ path ใต้ baseTopic — ระบบ derive `/set`, `/state`, `/config` ให้อัตโนมัติ

| Method | ใช้กับ | คำอธิบาย |
|--------|--------|---------|
| `onCommand(cb)` | Digital | `cb(bool on)` — fires ตอนรับ command |
| `onValue(cb)` | Analog | `cb(int value)` — fires ตอนรับค่า 0–255 |
| `attachPin(pin)` | Digital | auto GPIO control |
| `attachPWM(pin)` | Analog | auto PWM (LEDC) |
| `attachButton(pin)` | Digital | ปุ่มกดจริง active-low, debounce 50ms |
| `every(ms, cb)` | Sensor | publish ค่าจาก `cb()` ทุก ms |
| `turnOn()` / `turnOff()` / `toggle()` | Digital | สั่งจาก code |
| `setLevel(0..255)` | Analog | สั่งจาก code |
| `fade(ms)` | Analog | ค่อยๆ เปลี่ยนค่า (default 200ms) |
| `gamma(g)` | Analog | gamma correction สำหรับ LED (default 2.2) |
| `isOn()` / `level()` / `read()` | ตาม type | อ่านค่าปัจจุบัน |

---

## MQTT Payload Format

### Digital commands (`/set`)
| Payload | Result |
|---------|--------|
| `true` / `on` / `ON` / `1` | ON |
| `false` / `off` / `OFF` / `0` | OFF |
| `toggle` | Invert current state |

### Analog commands (`/set`)
Integer string `"0"` – `"255"`

### State reports (`/state`, retain=true)
- **NODE_DIGITAL**: `"true"` or `"false"`
- **NODE_ANALOG**: integer string `"0"` – `"255"`
- **NODE_SENSOR**: float string e.g. `"28.50"`

---

## Web App Device Configuration

ตอน node เชื่อม MQTT สำเร็จ → publish manifest ไปที่ `{base}/nodes/{nodeId}/manifest` (retained)
Web App subscribe topic นี้ → ค้นพบ devices อัตโนมัติ ไม่ต้องเพิ่มเอง

Topic ที่ derive ให้:
- **cmd**   → `{baseTopic}/{topic}/set` — Web App publish มาที่นี่
- **state** → `{baseTopic}/{topic}/state` — ESP32 publish (retain=true)

---

## Examples

| Sketch | สอนอะไร |
|--------|---------|
| `01_BasicDigital` | relay เปิด/ปิด พื้นฐาน |
| `02_MultiDevice` | หลาย device + callback 2 แบบ |
| `03_Sensor` | DHT22 publish ตามช่วงเวลา |
| `04_PhysicalButton` | ปุ่มกดจริง + sync ไป Web App |
| `05_PwmDimmer` | LED dimmer + fade + gamma |
| `06_Automation` | sensor → actuator rule บน node เอง |
| `07_NvsCredentials` | บันทึก credential ลง NVS ครั้งเดียว |
| `08_MqttAuth` | broker ที่ต้องการ user/pass |
| `09_LocalBroker` | Mosquitto/EMQX ใน LAN (plain MQTT) |

---

## Dependencies

| Library | Install via |
|---------|-------------|
| PubSubClient | Arduino Library Manager |
| DHT sensor library (examples only) | Arduino Library Manager |

Built-in (no install needed): `WiFi`, `WiFiClientSecure`, `Preferences`
