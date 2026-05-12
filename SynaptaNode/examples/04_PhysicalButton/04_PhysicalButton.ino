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

SynaptaDigital lamp("bedroom/lamp", 2);

void onLampChange(bool on) {
    Serial.println(on ? "Lamp: ON" : "Lamp: OFF");
}

void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    lamp.attachButton(5);        // GPIO 5 — internal pull-up, debounce 50ms
    lamp.onCommand(onLampChange);

    Synapta.onConnect   ([]() { Serial.println("[Synapta] Connected"); });
    Synapta.onDisconnect([]() { Serial.println("[Synapta] Disconnected — button still works"); });
}

void loop() {
    Synapta.loop();
}
