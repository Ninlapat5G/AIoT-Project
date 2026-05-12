#pragma once
#include <Arduino.h>
#include <functional>
#include "SynaptaRegistry.h"

// NODE_* prefix avoids conflict with ESP32 core macros (esp32-hal-gpio.h defines ANALOG)
enum DeviceType { NODE_DIGITAL, NODE_ANALOG, NODE_SENSOR };

class SynaptaDevice {
public:
    // ไม่มี pin → ใช้ NO_PIN (ตั้ง pin ได้ทีหลังผ่าน web app)
    static constexpr uint8_t NO_PIN = 255;

    // topic = full path ใต้ baseTopic เช่น "living-room/lamp"
    // ระบบจะ derive /set, /state, /config ให้อัตโนมัติ
    SynaptaDevice(const char* topic, DeviceType type);

    // DIGITAL: fires on "true"/"on"/"1"/"toggle"/"false"/"off"/"0"
    void onCommand(std::function<void(bool)> cb);

    // ANALOG: fires on 0–255 value
    void onValue(std::function<void(int)> cb);

    // Auto-drive a GPIO pin — ไม่ต้องเขียน callback เอง
    void attachPin(uint8_t pin);   // DIGITAL: HIGH/LOW
    void attachPWM(uint8_t pin);   // ANALOG: 8-bit PWM via ledcWrite

    // Active-low push button (internal pull-up, 50 ms debounce)
    // กดแล้ว toggle state + publish กลับ web app
    void attachButton(uint8_t pin);

    // SENSOR: เรียก cb ทุก intervalMs ms แล้ว publish ค่าที่ได้
    void every(uint32_t intervalMs, std::function<float()> cb);

    // ตั้ง state จาก code โดยตรง (เช่น จาก rule engine)
    void set(bool state);
    void set(int  value);

    // ANALOG: fade จากค่าเก่าไปค่าใหม่ในเวลา ms (default 200ms, 0 = instant)
    void setFadeMs(uint32_t ms) { _fadeMs = ms; }

    // ANALOG: gamma correction สำหรับ LED
    // 1.0 = linear (motor/heater), 2.2 = สายตามนุษย์ (LED — เรียก setGamma() เพื่อเปิด)
    void setGamma(float g);

    // ค่าปัจจุบัน — ใช้โดย RuleEngine
    float value() const;

    // Internal — เรียกโดย SynaptaNode
    void   _handleMessage(const char* payload);
    void   _handleConfig (const char* payload);  // รับ pin config จาก web: {"pin":2,"type":"digital"}
    void   _loadPinConfig();                     // โหลด pin จาก NVS ตอน boot
    void   _reportState() { _publishState(); }
    void   _loop();

    String _cmdTopic   (const String& base) const;  // {base}/{topic}/set
    String _stateTopic (const String& base) const;  // {base}/{topic}/state
    String _configTopic(const String& base) const;  // {base}/{topic}/config

    String _manifestEntry(const String& base) const;

    const String& getTopic() const { return _topic; }
    DeviceType    getType()  const { return _type; }
    const char*   typeName() const;  // "digital" | "analog" | "sensor"

private:
    String     _topic;
    DeviceType _type;

    bool  _stateBool  = false;
    float _stateFloat = 0;

    std::function<void(bool)>  _cbDigital;
    std::function<void(int)>   _cbAnalog;
    std::function<float()>     _cbSensor;

    uint8_t _pin = NO_PIN;
#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
    int8_t _pwmChannel = -1;
#endif

    // PWM fade + gamma (ANALOG only)
    uint32_t _fadeMs       = 200;
    int      _pwmTarget    = 0;
    int      _pwmCurrent   = 0;
    int      _fadeStartVal = 0;
    uint32_t _fadeStartMs  = 0;
    bool     _useGamma     = false;

    static uint8_t _gammaLut[256];
    static float   _gammaValue;

    uint8_t  _btnPin         = NO_PIN;
    bool     _btnLastReading = HIGH;
    bool     _btnPressed     = false;
    uint32_t _btnDebounceMs  = 0;

    uint32_t _interval   = 0;
    uint32_t _lastReport = 0;

    // NVS key = djb2 hash ของ topic (8 hex chars — อยู่ใน 15-char limit ของ NVS)
    String _nvKey() const;

    bool _parseBool(const char* s) const;
    void _executeDigital(bool on);
    void _executeAnalog (int  val);
    void _publishState  ();

    void _writePWM(int v);
    void _tickFade();
};
