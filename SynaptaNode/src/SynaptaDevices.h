#pragma once
#include "SynaptaDevice.h"

// ── Type-safe device wrappers (V1 preferred API) ──────────────────────────────
//
// ใช้งาน:
//   SynaptaDigital relay("bedroom/relay");
//   SynaptaAnalog  dimmer("bedroom/dimmer");
//   SynaptaSensor  temp("sensors/temp");
//
//   void setup() {
//     temp.every(5000, readTemp);
//     Synapta.begin("MyWiFi", "pass", "Mylab/smarthome");
//   }
//
// Pin assignment: Web App → Edit device → ใส่ Pin → Save
// ─────────────────────────────────────────────────────────────────────────────


// ── Digital — เปิด/ปิด ────────────────────────────────────────────────────────
class SynaptaDigital : public SynaptaDevice {
public:
    // topic = path ใต้ baseTopic เช่น "bedroom/relay"
    // pin assignment: ตั้งจาก Web App → Edit → Pin → Save
    // (ถ้าต้องการผูก pin ใน code: เรียก attachPin(2) แยกต่างหาก)
    explicit SynaptaDigital(const char* topic)
        : SynaptaDevice(topic, NODE_DIGITAL) {}

    bool isOn()  const { return value() > 0.5f; }
    void turnOn()      { set(true); }
    void turnOff()     { set(false); }
    void toggle()      { set(!isOn()); }
};


// ── Analog — ค่า 0–255 (PWM) ─────────────────────────────────────────────────
class SynaptaAnalog : public SynaptaDevice {
public:
    explicit SynaptaAnalog(const char* topic)
        : SynaptaDevice(topic, NODE_ANALOG) {}

    int  level()       const { return (int)value(); }
    void setLevel(int v)     { set(v); }

    // fade + gamma เป็น chainable — ใช้ตอนประกาศ global
    // ตัวอย่าง: SynaptaAnalog dim("bedroom/dimmer"); dim.fade(300).gamma();
    SynaptaAnalog& fade (uint32_t ms)  { setFadeMs(ms); return *this; }
    SynaptaAnalog& gamma(float g = 2.2f) { setGamma(g); return *this; }
};


// ── Sensor — publish ค่า float ตามช่วงเวลา ───────────────────────────────────
class SynaptaSensor : public SynaptaDevice {
public:
    // แบบ 1: ประกาศ topic ก่อน แล้วเรียก every() ใน setup()
    //   SynaptaSensor temp("sensors/temp");
    //   void setup() { temp.every(5000, readTemp); ... }
    explicit SynaptaSensor(const char* topic)
        : SynaptaDevice(topic, NODE_SENSOR) {}

    // แบบ 2: ระบุ interval และ function ในบรรทัดเดียวเลย
    //   SynaptaSensor temp("sensors/temp", 5000, readTemp);
    SynaptaSensor(const char* topic, uint32_t intervalMs, float(*readFn)())
        : SynaptaDevice(topic, NODE_SENSOR)
    {
        every(intervalMs, readFn);
    }

    float read() const { return value(); }
};
