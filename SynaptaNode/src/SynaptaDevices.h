#pragma once
#include "SynaptaDevice.h"

// ── Type-safe device wrappers (V1 preferred API) ──────────────────────────────
//
// ใช้งาน:
//   SynaptaDigital lamp("living-room/lamp");       // pin มาจาก web app
//   SynaptaDigital fan ("living-room/fan", 4);      // หรือระบุ pin ใน code ก็ได้
//   SynaptaAnalog  dim ("living-room/dimmer");
//   SynaptaSensor  temp("sensors/temp");
//
//   void setup() {
//     temp.every(5000, readTemp);
//     Synapta.begin("MyWiFi", "pass", "Mylab/smarthome");
//   }
// ─────────────────────────────────────────────────────────────────────────────


// ── Digital — เปิด/ปิด ────────────────────────────────────────────────────────
class SynaptaDigital : public SynaptaDevice {
public:
    // topic = path ใต้ baseTopic เช่น "living-room/lamp"
    // pin   = GPIO pin (ละได้ — ตั้งจาก web app ทีหลัง)
    SynaptaDigital(const char* topic, uint8_t pin = NO_PIN)
        : SynaptaDevice(topic, NODE_DIGITAL)
    {
        if (pin != NO_PIN) attachPin(pin);
    }

    bool isOn()  const { return value() > 0.5f; }
    void turnOn()      { set(true); }
    void turnOff()     { set(false); }
    void toggle()      { set(!isOn()); }
};


// ── Analog — ค่า 0–255 (PWM) ─────────────────────────────────────────────────
class SynaptaAnalog : public SynaptaDevice {
public:
    SynaptaAnalog(const char* topic, uint8_t pin = NO_PIN)
        : SynaptaDevice(topic, NODE_ANALOG)
    {
        if (pin != NO_PIN) attachPWM(pin);
    }

    int  level()       const { return (int)value(); }
    void setLevel(int v)     { set(v); }

    // fade + gamma เป็น chainable — ใช้ตอนประกาศ global
    // ตัวอย่าง: SynaptaAnalog dim("living-room/dimmer", 5); dim.fade(300).gamma();
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
