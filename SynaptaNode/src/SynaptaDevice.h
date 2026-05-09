#pragma once
#include <Arduino.h>
#include <functional>
#include "SynaptaRegistry.h"

// NODE_* prefix avoids conflict with ESP32 core macros (esp32-hal-gpio.h defines ANALOG)
enum DeviceType { NODE_DIGITAL, NODE_ANALOG, NODE_SENSOR };

class SynaptaDevice {
public:
    // Declare globally — device auto-registers and is subscribed on MQTT connect.
    // Topics: {baseTopic}/{room}/{id}/set  and  {baseTopic}/{room}/{id}/state
    SynaptaDevice(const char* id, const char* room, DeviceType type);

    // DIGITAL: fires on "true"/"on"/"1"/"toggle"/"false"/"off"/"0"
    void onCommand(std::function<void(bool)> cb);

    // ANALOG: fires on 0–255 value
    // Separate from onCommand to avoid bool/int ambiguity in C++
    void onValue(std::function<void(int)> cb);

    // Auto-drive a GPIO pin — no callback needed
    void attachPin(uint8_t pin);   // DIGITAL: HIGH/LOW
    void attachPWM(uint8_t pin);   // ANALOG: 8-bit PWM via ledcWrite

    // Attach active-low push button (internal pull-up, 50 ms debounce).
    // Pressing toggles state and publishes back to Web App.
    void attachButton(uint8_t pin);

    // SENSOR: call cb every intervalMs ms, publish the returned float
    void every(uint32_t intervalMs, std::function<float()> cb);

    // Set state manually from code (e.g. from a rule)
    void set(bool state);
    void set(int  value);

    // ANALOG: fade ระหว่างค่าเก่ากับค่าใหม่ในเวลา ms (default 100ms)
    // 0 = instant; ค่าใน MQTT/state = target — pin จะค่อย ๆ ขยับเอง
    void setFadeMs(uint32_t ms) { _fadeMs = ms; }

    // ANALOG: gamma correction สำหรับ LED — ตาคนรับรู้ความสว่างไม่เป็นเส้นตรง
    // 1.0 = linear (ดิบ — เหมาะ motor/heater); 2.2 = สายตามนุษย์ (เหมาะ LED — default)
    // call setGamma(1.0) เพื่อปิดถ้าใช้กับอุปกรณ์ที่ไม่ใช่ LED
    void setGamma(float g);

    // Current value — used by RuleEngine for condition evaluation
    float value() const;

    // Internal — called by SynaptaNode and RuleEngine
    void   _handleMessage(const char* payload);
    void   _reportState() { _publishState(); }
    void   _loop();

    String _cmdTopic  (const String& base) const;
    String _stateTopic(const String& base) const;

    // Manifest entry — JSON object used by SynaptaNode for discovery publish
    String _manifestEntry(const String& base) const;

    const String& getId()  const { return _id; }
    DeviceType    getType() const { return _type; }
    const char*   typeName() const;       // "digital" | "analog" | "sensor"

private:
    String     _id, _room;
    DeviceType _type;

    bool  _stateBool  = false;
    float _stateFloat = 0;

    std::function<void(bool)>  _cbDigital;
    std::function<void(int)>   _cbAnalog;
    std::function<float()>     _cbSensor;

    uint8_t _pin = 255;  // 255 = not attached
#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
    int8_t _pwmChannel = -1;  // LEDC channel for ESP32 core 2.x
#endif

    // ── PWM fade + gamma state (ANALOG only) ─────────────────────────────────
    uint32_t _fadeMs       = 100;   // V1 default: 100ms smooth (was 0 = instant)
    int      _pwmTarget    = 0;     // ค่าที่ user สั่งล่าสุด
    int      _pwmCurrent   = 0;     // ค่าจริงที่เขียนลง pin ตอนนี้
    int      _fadeStartVal = 0;
    uint32_t _fadeStartMs  = 0;
    bool     _useGamma     = false; // false = linear (default — opt-in สำหรับ LED)

    // shared gamma LUT — สร้างครั้งเดียว (last setGamma() call wins)
    static uint8_t _gammaLut[256];
    static float   _gammaValue;

    uint8_t  _btnPin         = 255;
    bool     _btnLastReading = HIGH;
    bool     _btnPressed     = false;
    uint32_t _btnDebounceMs  = 0;

    uint32_t _interval   = 0;
    uint32_t _lastReport = 0;

    bool _parseBool(const char* s) const;
    void _executeDigital(bool on);
    void _executeAnalog (int  val);
    void _publishState  ();

    void _writePWM(int v);   // wrapper เลือก ledcWrite ตาม core 2.x/3.x
    void _tickFade();        // เรียกใน _loop() — ขยับ _pwmCurrent → _pwmTarget

    static String _normalise(const String& s);
};
