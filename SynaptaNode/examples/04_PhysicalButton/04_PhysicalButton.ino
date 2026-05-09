/*
 * 04_PhysicalButton — ปุ่มกดจริงบน GPIO + sync ไป MQTT
 *
 * กดปุ่ม:
 *   1. toggle state ใน device
 *   2. GPIO เปลี่ยนตาม
 *   3. publish state ใหม่ → Web App UI อัพเดทตาม
 *
 * แม้ WiFi หลุด ปุ่มยังกดเปิด/ปิดได้ปกติ (state จะ sync เมื่อ MQTT กลับมา)
 *
 * Wiring:
 *   Relay IN → GPIO 2
 *   Button   → GPIO 5, ขาอีกข้าง → GND  (internal pull-up, active-low)
 */

#include <Synapta.h>

// pin 2 = GPIO ที่ผูก output (relay)
SynaptaDigital lamp("bedroom-lamp", "bedroom", 2);


// ── callback แบบ free function (ไม่ต้องใช้ lambda) ──
void onLampChange(bool on) {
    if (on) {
        Serial.println("Lamp: ON");
    } else {
        Serial.println("Lamp: OFF");
    }
}

void onConnected() {
    Serial.println("[Synapta] Connected");
}

void onDisconnected() {
    Serial.println("[Synapta] Disconnected — button still works");
}


void setup() {
    Serial.begin(115200);

    // ── config ทีละบรรทัด — Arduino style ──
    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    // ── ผูกปุ่มเข้า device ──
    lamp.attachButton(5);   // GPIO 5 — internal pull-up, debounce 50ms

    // ── ผูก callback (ใช้ free function ที่ประกาศไว้ข้างบน) ──
    lamp.onCommand(onLampChange);
    Synapta.onConnect(onConnected);
    Synapta.onDisconnect(onDisconnected);
}

void loop() {
    Synapta.loop();
}
