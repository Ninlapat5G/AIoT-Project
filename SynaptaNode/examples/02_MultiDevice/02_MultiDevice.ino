/*
 * 02_MultiDevice — หลาย device บน ESP32 ตัวเดียว + วิธีเขียน callback 2 แบบ
 *
 * Pin assignment: ตั้งจาก Web App → Edit แต่ละ device → ใส่ Pin → Save
 */

#include <Synapta.h>

SynaptaDigital relay ("bedroom/relay");
SynaptaAnalog  dimmer("bedroom/dimmer");


void onRelayChange(bool on) {
    Serial.println(on ? "Relay: ON" : "Relay: OFF");
}


void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    // ส่งชื่อ function เข้าไปตรงๆ — ไม่ต้อง lambda
    relay.onCommand(onRelayChange);

    // ถ้า dimmer ต่อกับ LED — เปิด gamma ให้ตาเห็น "ค่อยๆ สว่าง" สมจริง
    dimmer.gamma();

    // callback แบบ lambda
    dimmer.onValue([](int val) {
        Serial.print("Dimmer: ");
        Serial.print(val);
        Serial.println("/255");
    });
}

void loop() {
    Synapta.loop();
}
