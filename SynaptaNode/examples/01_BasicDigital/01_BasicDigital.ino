/*
 * 01_BasicDigital — เปิด/ปิดอุปกรณ์ดิจิตอลตัวเดียว (relay / LED)
 *
 * Web App รู้จัก device อัตโนมัติผ่าน manifest — ไม่ต้องกรอกเอง
 * (เปิด Serial Monitor ดู nodeId หลัง Synapta.start())
 *
 * Wiring: Relay IN → GPIO 2
 */

#include <Synapta.h>

// ── ประกาศ device — ใส่ pin ใน constructor เลย ───────────────────────────────
// ของเก่า:  SynaptaDevice relay("...", "...", NODE_DIGITAL); + relay.attachPin(2)
// ของใหม่:  บรรทัดเดียวจบ + auto attach GPIO
SynaptaDigital relay("bedroom-relay", "bedroom", 2);

void setup() {
    Serial.begin(115200);

    // ── เลือก style ไหนก็ได้ ผลเหมือนกัน ─────────────────────────────────────

    // (A) ทีละบรรทัด — Arduino style อ่านง่าย
    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    // (B) แบบ chain (compact) — ใช้แทน A
    // Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD")
    //        .baseTopic("Mylab/smarthome")
    //        .start();
}

void loop() {
    Synapta.loop();
}

/*
 * ── สั่งจาก code โดยตรง (ถ้าต้องการ) ──
 *   relay.turnOn();
 *   relay.turnOff();
 *   relay.toggle();
 *   if (relay.isOn()) { ... }
 */
