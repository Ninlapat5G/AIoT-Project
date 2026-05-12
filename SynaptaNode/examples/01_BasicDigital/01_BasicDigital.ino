/*
 * 01_BasicDigital — เปิด/ปิดอุปกรณ์ดิจิตอลตัวเดียว (relay / LED)
 *
 * Web App ตั้งค่า topic ใน device edit form แล้วกด Save
 * หรือระบุ pin ใน code ก็ได้ — สองวิธีทำงานเหมือนกัน
 *
 * Wiring: Relay IN → GPIO 2
 */

#include <Synapta.h>

// topic = path ใต้ baseTopic เช่น "bedroom/relay"
// → /set   รับ command จาก web
// → /state ส่ง state กลับ web
// → /config รับ pin assignment จาก web ตอนกด Save
SynaptaDigital relay("bedroom/relay", 2);   // pin 2 — หรือละ pin ไว้ ตั้งจาก web ได้

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
