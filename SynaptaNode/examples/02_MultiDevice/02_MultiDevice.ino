/*
 * 02_MultiDevice — หลาย device บน ESP32 ตัวเดียว + วิธีเขียน callback 2 แบบ
 *
 * Wiring:
 *   Relay IN   → GPIO 2
 *   LED/MOSFET → GPIO 4  (PWM capable)
 */

#include <Synapta.h>

SynaptaDigital relay ("bedroom/relay",  2);
SynaptaAnalog  dimmer("bedroom/dimmer", 4);

// PWM ของ dimmer default fade 200ms อัตโนมัติ — ปรับได้ใน setup()


// ── callback แบบ free function (Arduino style) ──
void onRelayChange(bool on) {
    Serial.println(on ? "Relay: ON" : "Relay: OFF");
}


void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD")
           .baseTopic("Mylab/smarthome")
           .start();

    // ส่งชื่อ function เข้าไปตรงๆ — ไม่ต้อง lambda
    relay.onCommand(onRelayChange);

    // ถ้า dimmer ต่อกับ LED — เปิด gamma ให้ตาเห็น "ค่อยๆ สว่าง" สมจริง
    dimmer.gamma();   // = gamma(2.2)
    // ถ้าเป็น motor/heater — ไม่ต้องเรียก gamma เลย

    // ── callback แบบ lambda ──
    dimmer.onValue([](int val) {
        Serial.print("Dimmer: ");
        Serial.print(val);
        Serial.println("/255");
    });
}

void loop() {
    Synapta.loop();
}

/*
 * ── สั่งจาก code ──
 *   relay.turnOn();   relay.turnOff();   relay.toggle();
 *   dimmer.setLevel(128);   int v = dimmer.level();
 */
