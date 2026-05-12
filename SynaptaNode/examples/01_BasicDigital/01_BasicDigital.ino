/*
 * 01_BasicDigital — เปิด/ปิดอุปกรณ์ดิจิตอลตัวเดียว (relay / LED)
 *
 * Wiring และ pin assignment: ตั้งได้จาก Web App → เปิด device → กด Edit → ใส่ Pin → Save
 */

#include <Synapta.h>

SynaptaDigital relay("bedroom/relay");

void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();
}

void loop() {
    Synapta.loop();
}

/*
 * ── สั่งจาก code ──
 *   relay.turnOn();
 *   relay.turnOff();
 *   relay.toggle();
 *   if (relay.isOn()) { ... }
 */
