#include "SynaptaDevice.h"
#include "SynaptaNode.h"
#include <Preferences.h>
#include <math.h>

static const char* PIN_NS = "syn-pins";  // NVS namespace สำหรับ pin config

uint8_t SynaptaDevice::_gammaLut[256];
float   SynaptaDevice::_gammaValue = 0.0f;

SynaptaDevice::SynaptaDevice(const char* topic, DeviceType type)
    : _topic(topic), _type(type)
{
    _SynaptaRegistry::devices().push_back(this);
}

void SynaptaDevice::onCommand(std::function<void(bool)> cb) { _cbDigital = cb; }
void SynaptaDevice::onValue  (std::function<void(int)>  cb) { _cbAnalog  = cb; }

void SynaptaDevice::attachPin(uint8_t pin) {
    _pin = pin;
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
}

void SynaptaDevice::attachPWM(uint8_t pin) {
    _pin = pin;
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(pin, 5000, 8);
    ledcWrite(pin, 0);
#else
    static uint8_t nextChannel = 0;
    _pwmChannel = (int8_t)(nextChannel++ & 0x0F);
    ledcSetup(_pwmChannel, 5000, 8);
    ledcAttachPin(pin, _pwmChannel);
    ledcWrite(_pwmChannel, 0);
#endif
}

void SynaptaDevice::attachButton(uint8_t pin) {
    _btnPin = pin;
    pinMode(pin, INPUT_PULLUP);
}

void SynaptaDevice::every(uint32_t intervalMs, std::function<float()> cb) {
    _interval = intervalMs;
    _cbSensor = cb;
}

void SynaptaDevice::set(bool state) {
    _executeDigital(state);
    _publishState();
}

void SynaptaDevice::set(int value) {
    _executeAnalog(value);
    _publishState();
}

float SynaptaDevice::value() const {
    return (_type == NODE_DIGITAL) ? (_stateBool ? 1.0f : 0.0f) : _stateFloat;
}

// ── Topic helpers ─────────────────────────────────────────────────────────────
// topic ที่ user ตั้งไว้ เช่น "living-room/lamp"
// ระบบเติม /set /state /config ให้เองโดยอัตโนมัติ

String SynaptaDevice::_cmdTopic   (const String& base) const { return base + "/" + _topic + "/set"; }
String SynaptaDevice::_stateTopic (const String& base) const { return base + "/" + _topic + "/state"; }
String SynaptaDevice::_configTopic(const String& base) const { return base + "/" + _topic + "/config"; }

const char* SynaptaDevice::typeName() const {
    if (_type == NODE_DIGITAL) return "digital";
    if (_type == NODE_ANALOG)  return "analog";
    return "sensor";
}

// ── Manifest entry ────────────────────────────────────────────────────────────
// JSON ที่ publish ตอน connect — web app ใช้ discover devices อัตโนมัติ

String SynaptaDevice::_manifestEntry(const String& base) const {
    String j = "{\"topic\":\"";
    j += _topic;
    j += "\",\"type\":\"";
    j += typeName();
    j += "\",\"stateTopic\":\"";
    j += _stateTopic(base);
    j += "\"";
    if (_type != NODE_SENSOR) {
        j += ",\"cmdTopic\":\"";
        j += _cmdTopic(base);
        j += "\",\"configTopic\":\"";
        j += _configTopic(base);
        j += "\"";
    }
    j += "}";
    return j;
}

// ── Command handler ───────────────────────────────────────────────────────────

void SynaptaDevice::_handleMessage(const char* payload) {
    if (_type == NODE_DIGITAL) {
        bool on = _parseBool(payload);
        _executeDigital(on);
        _publishState();
    } else if (_type == NODE_ANALOG) {
        int val = constrain(String(payload).toInt(), 0, 255);
        _executeAnalog(val);
        _publishState();
    }
    // NODE_SENSOR ไม่รับ command
}

// ── Config handler ────────────────────────────────────────────────────────────
// รับ JSON จาก web app ตอนกด save: {"pin":2,"type":"digital"} หรือ {"pin":5,"type":"pwm"}
// เช็คค่าเดิมใน NVS ก่อน — เขียนเฉพาะเมื่อเปลี่ยนจริง (ถนอม flash)

void SynaptaDevice::_handleConfig(const char* payload) {
    String p(payload);

    // parse "pin": N  (ไม่ใช้ ArduinoJson เพื่อไม่เพิ่ม dependency)
    int pinIdx = p.indexOf("\"pin\":");
    if (pinIdx < 0) return;
    int pin = p.substring(pinIdx + 6).toInt();
    if (pin < 0 || pin > 48) return;

    bool isPwm = (p.indexOf("\"pwm\"") >= 0 || p.indexOf("\"analog\"") >= 0);

    // อ่านค่าเดิมจาก NVS เพื่อเช็คว่าเปลี่ยนจริงหรือเปล่า
    String key  = _nvKey();
    String keyT = key + "t";
    Preferences prefs;
    prefs.begin(PIN_NS, true);
    int  oldPin  = prefs.getInt (key.c_str(),  -1);
    bool oldIsPwm = prefs.getBool(keyT.c_str(), false);
    prefs.end();

    if (oldPin == pin && oldIsPwm == isPwm) {
        Serial.printf("[Synapta] Config unchanged for %s — skip NVS write\n", _topic.c_str());
        return;
    }

    // บันทึกลง NVS
    prefs.begin(PIN_NS, false);
    prefs.putInt (key.c_str(),  pin);
    prefs.putBool(keyT.c_str(), isPwm);
    prefs.end();

    Serial.printf("[Synapta] Config saved: %s → pin %d (%s)\n",
                  _topic.c_str(), pin, isPwm ? "pwm" : "digital");

    // Apply ทันที
    if (isPwm) attachPWM((uint8_t)pin);
    else       attachPin((uint8_t)pin);
}

// ── Boot: load pin from NVS ───────────────────────────────────────────────────
// เรียกใน SynaptaNode::_init() หลัง device ลงทะเบียนแล้ว
// ถ้าไม่เคย config มาก่อน → ข้ามไป (pin ยังเป็น NO_PIN)

void SynaptaDevice::_loadPinConfig() {
    String key  = _nvKey();
    String keyT = key + "t";
    Preferences prefs;
    prefs.begin(PIN_NS, true);
    int  pin   = prefs.getInt (key.c_str(),  -1);
    bool isPwm = prefs.getBool(keyT.c_str(), false);
    prefs.end();

    if (pin < 0 || pin > 48) return;  // ยังไม่เคย config

    Serial.printf("[Synapta] Loaded pin config: %s → pin %d (%s)\n",
                  _topic.c_str(), pin, isPwm ? "pwm" : "digital");

    if (isPwm) attachPWM((uint8_t)pin);
    else       attachPin((uint8_t)pin);
}

// ── NVS key ───────────────────────────────────────────────────────────────────
// djb2 hash ของ topic → 8 hex chars (ไม่เกิน 15-char limit ของ NVS key)

String SynaptaDevice::_nvKey() const {
    uint32_t h = 5381;
    for (const char* c = _topic.c_str(); *c; c++) h = ((h << 5) + h) + *c;
    char buf[9];
    snprintf(buf, sizeof(buf), "%08lx", (unsigned long)h);
    return String(buf);
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void SynaptaDevice::_loop() {
    // Sensor: publish ตามช่วงเวลาที่กำหนด
    if (_type == NODE_SENSOR && _cbSensor && _interval > 0) {
        if (millis() - _lastReport >= _interval) {
            _lastReport = millis();
            _stateFloat = _cbSensor();
            _publishState();
        }
    }

    // PWM fade: เลื่อน _pwmCurrent → _pwmTarget ทีละ tick
    if (_type == NODE_ANALOG) _tickFade();

    // Button debounce 50ms: กดแล้ว toggle + publish
    if (_btnPin != NO_PIN) {
        bool reading = (digitalRead(_btnPin) == LOW);

        if (reading != _btnLastReading) {
            _btnDebounceMs = millis();
        }

        if (millis() - _btnDebounceMs > 50) {
            if (reading != _btnPressed) {
                _btnPressed = reading;
                if (_btnPressed) {
                    _stateBool = !_stateBool;
                    _executeDigital(_stateBool);
                    _publishState();
                }
            }
        }

        _btnLastReading = reading;
    }
}

// ── Execute helpers ───────────────────────────────────────────────────────────

void SynaptaDevice::_executeDigital(bool on) {
    _stateBool = on;
    if (_pin != NO_PIN) digitalWrite(_pin, on ? HIGH : LOW);
    if (_cbDigital) _cbDigital(on);
}

void SynaptaDevice::_executeAnalog(int val) {
    _stateFloat = val;   // state ที่ publish = target ที่ user สั่ง
    _pwmTarget  = val;

    if (_fadeMs == 0 || _pin == NO_PIN) {
        // instant
        _pwmCurrent = val;
        _writePWM(val);
    } else {
        // เริ่ม fade — _tickFade() จะขยับไปเองทุก loop tick
        _fadeStartVal = _pwmCurrent;
        _fadeStartMs  = millis();
    }

    if (_cbAnalog) _cbAnalog(val);
}

// ── PWM helpers ───────────────────────────────────────────────────────────────

void SynaptaDevice::_writePWM(int v) {
    if (_pin == NO_PIN) return;
    int actual = (_useGamma && v >= 0 && v <= 255) ? _gammaLut[v] : v;
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(_pin, actual);
#else
    if (_pwmChannel >= 0) ledcWrite(_pwmChannel, actual);
#endif
}

void SynaptaDevice::setGamma(float g) {
    if (g <= 1.0f) { _useGamma = false; return; }
    _useGamma = true;
    if (g != _gammaValue) {
        _gammaValue = g;
        for (int i = 0; i < 256; i++) {
            float n = (float)i / 255.0f;
            _gammaLut[i] = (uint8_t)(powf(n, g) * 255.0f + 0.5f);
        }
    }
}

void SynaptaDevice::_tickFade() {
    if (_fadeMs == 0 || _pin == NO_PIN) return;
    if (_pwmCurrent == _pwmTarget)      return;

    uint32_t elapsed = millis() - _fadeStartMs;
    int next;
    if (elapsed >= _fadeMs) {
        next = _pwmTarget;
    } else {
        long delta = (long)(_pwmTarget - _fadeStartVal) * (long)elapsed;
        next = _fadeStartVal + (int)(delta / (long)_fadeMs);
    }

    if (next != _pwmCurrent) {
        _pwmCurrent = next;
        _writePWM(next);
    }
}

// ── State publish ─────────────────────────────────────────────────────────────

void SynaptaDevice::_publishState() {
    const String& base = Synapta.config().baseTopic;
    String payload;
    if (_type == NODE_DIGITAL) {
        payload = _stateBool ? "true" : "false";
    } else if (_type == NODE_ANALOG) {
        payload = String((int)_stateFloat);
    } else {
        payload = String(_stateFloat, 2);
    }
    Synapta._publish(_stateTopic(base).c_str(), payload.c_str(), true);
}

// ── Bool parser ───────────────────────────────────────────────────────────────

bool SynaptaDevice::_parseBool(const char* s) const {
    String str(s);
    str.trim();
    if (str.equalsIgnoreCase("toggle")) return !_stateBool;
    return str.equalsIgnoreCase("true") ||
           str.equalsIgnoreCase("on")   ||
           str == "1";
}
