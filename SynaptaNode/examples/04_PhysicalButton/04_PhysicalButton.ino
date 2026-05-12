/*
 * 04_PhysicalButton — ปุ่มกดจริงบน GPIO + sync ไป MQTT
 *
 * กดปุ่ม → toggle state → GPIO เปลี่ยนตาม → Web App UI อัพเดท
 * แม้ WiFi หลุด ปุ่มยังกดได้ปกติ — state sync เมื่อ MQTT กลับมา
 *
 * Pin assignment: ตั้งจาก Web App → Edit → ใส่ Pin → Save
 * Button pin: ตั้งใน attachButton() ด้านล่าง
 */

#include <Synapta.h>

SynaptaDigital lamp("bedroom/lamp");

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
