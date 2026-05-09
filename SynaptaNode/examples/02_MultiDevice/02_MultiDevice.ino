/*
 * 02_MultiDevice — หลาย device บน ESP32 ตัวเดียว + วิธีเขียน callback 2 แบบ
 *
 * Wiring:
 *   Relay IN   → GPIO 2
 *   LED/MOSFET → GPIO 4  (PWM capable)
 */

#include <Synapta.h>

// ── ประกาศ device — Digital + Analog บนบอร์ดเดียว ────────────────────────────
SynaptaDigital relay ("bedroom-relay",  "bedroom", 2);
SynaptaAnalog  dimmer("bedroom-dimmer", "bedroom", 4);

// ── หรือเปิด smooth fade เลย (ค่อย ๆ ขยับใน 500ms ทุกครั้งที่เปลี่ยนค่า) ─────
//   SynaptaAnalog dimmer("bedroom-dimmer", "bedroom", 4);
//   dimmer.fade(500);   // เรียกใน setup() ก็ได้


// ─────────────────────────────────────────────────────────────────────────────
// วิธีเขียน callback 2 แบบ — เลือกตามถนัด
// ─────────────────────────────────────────────────────────────────────────────

// แบบที่ 1: เขียน function ปกติ (เหมือน Arduino เดิม)
// ── ข้อดี: คุ้นเคย อ่านง่าย แยก logic ได้ชัด
void onRelayChange(bool on) {
    if (on) {
        Serial.println("Relay: ON");
    } else {
        Serial.println("Relay: OFF");
    }
}


void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD")
           .baseTopic("Mylab/smarthome")
           .start();

    // ใช้แบบที่ 1: ส่งชื่อ function เข้าไป
    relay.onCommand(onRelayChange);

    // เปิด smooth fade — dimmer ค่อย ๆ ปรับค่าใน 500ms (default = instant)
    dimmer.fade(500);

    // ─────────────────────────────────────────────────────────────────────────
    // แบบที่ 2: lambda — เขียน function ทันทีในวงเล็บ
    // syntax: [](type ชื่อ) { code; }
    //   []        = capture (ส่วนใหญ่ใช้ว่าง — ไม่ต้องเข้าใจตอนนี้ก็ได้)
    //   (int val) = พารามิเตอร์ที่จะรับ
    //   { ... }   = body ของ function
    // ── ข้อดี: code อยู่ตรงที่ register ไม่ต้องตั้งชื่อ function
    // ─────────────────────────────────────────────────────────────────────────
    dimmer.onValue([](int val) {
        Serial.print("Dimmer: ");
        Serial.print(val);
        Serial.println("/255");
    });

    // ── เทียบ — โค้ดข้างบนเหมือนเขียนแบบนี้แล้วเรียก dimmer.onValue(onDimmer) ──
    // void onDimmer(int val) {
    //     Serial.print("Dimmer: "); Serial.print(val); Serial.println("/255");
    // }
}

void loop() {
    Synapta.loop();
}

/*
 * ── สั่งจาก code ──
 *   relay.turnOn();    relay.turnOff();    relay.toggle();
 *   dimmer.setLevel(128);   int v = dimmer.level();
 */
