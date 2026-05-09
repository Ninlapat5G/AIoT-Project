/*
 * 03_Sensor — sensor publish ค่าเป็นช่วงเวลา (DHT22)
 *
 * Sensor publish อย่างเดียว ไม่รับ command
 * Web App AI อ่านค่าผ่าน mqtt_read หรือดูใน KG snapshot
 *
 * Wiring: DHT22 DATA → GPIO 15
 * Library required: "DHT sensor library" by Adafruit
 */

#include <Synapta.h>
#include <DHT.h>

DHT dht(15, DHT22);

// ─────────────────────────────────────────────────────────────────────────────
// 2 วิธีประกาศ sensor — เลือกตามถนัด
// ─────────────────────────────────────────────────────────────────────────────

// ── วิธีที่ 1: callback แยก function (Arduino style) ─────────────────────────
float readTemp() {
    float t = dht.readTemperature();
    if (isnan(t)) {
        Serial.println("Sensor read failed");
        return 0.0f;
    }
    Serial.print("Temperature: ");
    Serial.print(t);
    Serial.println(" C");
    return t;
}

SynaptaSensor temp("bedroom-temp", "bedroom");


// ── วิธีที่ 2: ใส่ทุกอย่างใน constructor (compact, ใช้ lambda) ────────────────
// SynaptaSensor temp("bedroom-temp", "bedroom", 30000, []() {
//     return dht.readTemperature();
// });


void setup() {
    Serial.begin(115200);
    dht.begin();

    // ── config ──
    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    // ── ผูก sensor (ถ้าใช้วิธีที่ 1) — read ทุก 30 วินาที ──
    temp.every(30000, readTemp);

    // ถ้าใช้วิธีที่ 2 ตัดบรรทัด temp.every() ทิ้งได้เลย
}

void loop() {
    Synapta.loop();
}
