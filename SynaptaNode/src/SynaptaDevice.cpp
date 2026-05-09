#include "SynaptaDevice.h"
#include "SynaptaNode.h"
#include <math.h>

// Static gamma LUT — shared across all analog devices
uint8_t SynaptaDevice::_gammaLut[256];
float   SynaptaDevice::_gammaValue = 0.0f;

SynaptaDevice::SynaptaDevice(const char* id, const char* room, DeviceType type)
    : _id(id), _room(room), _type(type)
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
    // ESP32 core 2.x uses channel-based LEDC (max 16 channels: 0-15)
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
    if (_type == NODE_DIGITAL) {
        if (_stateBool) return 1.0f;
        return 0.0f;
    }
    return _stateFloat;
}

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
    // NODE_SENSOR ignores commands
}

void SynaptaDevice::_loop() {
    if (_type == NODE_SENSOR && _cbSensor && _interval > 0) {
        if (millis() - _lastReport >= _interval) {
            _lastReport = millis();
            _stateFloat = _cbSensor();
            _publishState();
        }
    }

    // PWM fade — ขยับ current → target ทีละนิดทุก loop tick
    if (_type == NODE_ANALOG) _tickFade();

    if (_btnPin != 255) {
        bool reading = (digitalRead(_btnPin) == LOW);

        if (reading != _btnLastReading) {
            _btnDebounceMs = millis();  // restart timer on any change
        }

        if (millis() - _btnDebounceMs > 50) {  // stable for 50 ms = real press
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

String SynaptaDevice::_cmdTopic(const String& base) const {
    return base + "/" + _normalise(_room) + "/" + _id + "/set";
}

String SynaptaDevice::_stateTopic(const String& base) const {
    return base + "/" + _normalise(_room) + "/" + _id + "/state";
}

const char* SynaptaDevice::typeName() const {
    if (_type == NODE_DIGITAL) return "digital";
    if (_type == NODE_ANALOG)  return "analog";
    return "sensor";
}

// Build one JSON object describing this device — joined into the node manifest.
// Note: id/room are trusted user input — no escaping done. Avoid quotes/backslashes.
String SynaptaDevice::_manifestEntry(const String& base) const {
    String j = "{\"id\":\"";
    j += _id;
    j += "\",\"room\":\"";
    j += _room;
    j += "\",\"type\":\"";
    j += typeName();
    j += "\",\"stateTopic\":\"";
    j += _stateTopic(base);
    j += "\"";
    if (_type != NODE_SENSOR) {
        j += ",\"cmdTopic\":\"";
        j += _cmdTopic(base);
        j += "\"";
    }
    j += "}";
    return j;
}

void SynaptaDevice::_executeDigital(bool on) {
    _stateBool = on;
    if (_pin != 255) {
        if (on) {
            digitalWrite(_pin, HIGH);
        } else {
            digitalWrite(_pin, LOW);
        }
    }
    if (_cbDigital) _cbDigital(on);
}

void SynaptaDevice::_executeAnalog(int val) {
    _stateFloat = val;       // state ที่ publish = target ที่ user สั่ง
    _pwmTarget  = val;

    if (_fadeMs == 0 || _pin == 255) {
        // instant — เขียน pin ทันที (เหมือนเดิม)
        _pwmCurrent = val;
        _writePWM(val);
    } else {
        // เริ่ม fade — _tickFade() ใน _loop จะขยับ _pwmCurrent ทีละ tick
        _fadeStartVal = _pwmCurrent;
        _fadeStartMs  = millis();
    }

    if (_cbAnalog) _cbAnalog(val);
}

// ── PWM helpers ─────────────────────────────────────────────────────────────

void SynaptaDevice::_writePWM(int v) {
    if (_pin == 255) return;
    int actual = v;
    if (_useGamma) {
        if (actual < 0)   actual = 0;
        if (actual > 255) actual = 255;
        actual = _gammaLut[actual];
    }
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(_pin, actual);
#else
    if (_pwmChannel >= 0) ledcWrite(_pwmChannel, actual);
#endif
}

// ── Gamma correction ─────────────────────────────────────────────────────────
// LUT ที่คำนวณ pow(i/255, g)*255 แล้ว — ใช้ lookup แทน pow() runtime
// Shared static — ถ้า 2 devices เรียก setGamma() ต่างค่า อันสุดท้ายชนะ

void SynaptaDevice::setGamma(float g) {
    if (g <= 1.0f) {
        _useGamma = false;     // 1.0 หรือต่ำกว่า = linear (no correction)
        return;
    }
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
    if (_fadeMs == 0)              return;   // instant mode — ไม่ทำอะไร
    if (_pin == 255)               return;
    if (_pwmCurrent == _pwmTarget) return;   // ถึงเป้าแล้ว

    uint32_t elapsed = millis() - _fadeStartMs;
    int next;
    if (elapsed >= _fadeMs) {
        next = _pwmTarget;
    } else {
        // linear interpolation: start + (target - start) * elapsed / total
        long delta = (long)(_pwmTarget - _fadeStartVal) * (long)elapsed;
        next = _fadeStartVal + (int)(delta / (long)_fadeMs);
    }

    if (next != _pwmCurrent) {
        _pwmCurrent = next;
        _writePWM(next);
    }
}

void SynaptaDevice::_publishState() {
    const String& base = Synapta.config().baseTopic;
    String payload;
    if (_type == NODE_DIGITAL) {
        if (_stateBool) {
            payload = "true";
        } else {
            payload = "false";
        }
    } else if (_type == NODE_ANALOG) {
        payload = String((int)_stateFloat);
    } else {
        payload = String(_stateFloat, 2);
    }
    Synapta._publish(_stateTopic(base).c_str(), payload.c_str(), true);
}

bool SynaptaDevice::_parseBool(const char* s) const {
    String str(s);
    str.trim();
    if (str.equalsIgnoreCase("toggle")) return !_stateBool;
    return str.equalsIgnoreCase("true") ||
           str.equalsIgnoreCase("on")   ||
           str == "1";
}

String SynaptaDevice::_normalise(const String& s) {
    String out = s;
    out.toLowerCase();
    out.replace(" ", "-");
    return out;
}
