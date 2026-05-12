/*
 * 05_PwmDimmer — LED dimmer ที่ fade นุ่ม + gamma correction
 *
 * fade(ms)  — เวลาที่ใช้ค่อยๆ เปลี่ยนค่า (default 200ms, 0 = ทันที)
 * gamma()   — แก้ค่า PWM ให้ตาเห็น brightness แบบ linear (สำหรับ LED)
 *             motor/heater ไม่ต้องใช้
 *
 * Pin assignment: Web App → Edit "bedroom/led" → ใส่ Pin → Save
 */

#include <Synapta.h>

SynaptaAnalog led("bedroom/led");

void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    led.fade(500);   // ค่อยๆ เปลี่ยนค่าใน 500ms
    led.gamma();     // gamma 2.2 สำหรับ LED ให้ตาเห็นเป็น linear
}

void loop() {
    Synapta.loop();
}

/*
 * ── สั่งจาก code ──
 *   led.setLevel(0);     // ดับ
 *   led.setLevel(128);   // ครึ่ง
 *   led.setLevel(255);   // เต็ม
 *   int v = led.level(); // อ่านค่าปัจจุบัน (0–255)
 */
