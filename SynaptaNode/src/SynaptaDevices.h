#pragma once
#include "SynaptaDevice.h"

// ──────────────────────────────────────────────────────────────────────────────
// Type-safe device wrappers (V1 preferred API)
//
// แทนที่ NODE_DIGITAL / NODE_ANALOG / NODE_SENSOR + attachPin/attachPWM แยก
// ใช้ class ที่มี pin ใน constructor + method เฉพาะชนิด
//
// ของเก่าใช้ได้อยู่:  SynaptaDevice relay("...","...", NODE_DIGITAL); relay.attachPin(2);
// แบบใหม่:           SynaptaDigital relay("...","...", 2);
// ──────────────────────────────────────────────────────────────────────────────


// ── Digital — เปิด/ปิด ─────────────────────────────────────────────────────────
class SynaptaDigital : public SynaptaDevice {
public:
    // ใส่ pin = ผูก GPIO อัตโนมัติ; ใส่ 255 หรือไม่ใส่ = manual control ผ่าน onCommand
    SynaptaDigital(const char* id, const char* room, uint8_t pin = 255)
        : SynaptaDevice(id, room, NODE_DIGITAL)
    {
        if (pin != 255) attachPin(pin);
    }

    // อ่าน/สั่งสถานะแบบตรงไปตรงมา
    bool isOn() const     { return value() > 0.5f; }
    void turnOn()         { set(true); }
    void turnOff()        { set(false); }
    void toggle()         { set(!isOn()); }
};


// ── Analog — ค่า 0-255 (PWM) ──────────────────────────────────────────────────
class SynaptaAnalog : public SynaptaDevice {
public:
    SynaptaAnalog(const char* id, const char* room, uint8_t pin = 255)
        : SynaptaDevice(id, room, NODE_ANALOG)
    {
        if (pin != 255) attachPWM(pin);
    }

    int  level() const    { return (int)value(); }
    void setLevel(int v)  { set(v); }

    // ปรับเวลา fade (default 100ms) — chainable
    SynaptaAnalog& fade(uint32_t ms) { setFadeMs(ms); return *this; }

    // เปิด gamma correction สำหรับ LED — ค่า 2.2 = สายตามนุษย์ (default ถ้าไม่ใส่)
    // ใช้กับ LED แล้วจะดูเปลี่ยนนุ่มนวลกว่า linear PWM มาก
    SynaptaAnalog& gamma(float g = 2.2f) { setGamma(g); return *this; }
};


// ── Sensor — publish ค่า float เป็นช่วงเวลา ────────────────────────────────────
class SynaptaSensor : public SynaptaDevice {
public:
    // แบบไม่ใส่ callback — เรียก every() ทีหลัง
    SynaptaSensor(const char* id, const char* room)
        : SynaptaDevice(id, room, NODE_SENSOR) {}

    // แบบใส่ครบในบรรทัดเดียว
    SynaptaSensor(const char* id, const char* room,
                  uint32_t intervalMs, std::function<float()> readFn)
        : SynaptaDevice(id, room, NODE_SENSOR)
    {
        every(intervalMs, readFn);
    }

    float read() const   { return value(); }
};
