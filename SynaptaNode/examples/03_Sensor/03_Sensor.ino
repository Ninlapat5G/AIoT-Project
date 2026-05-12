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

float readTemp() {
    float t = dht.readTemperature();
    if (isnan(t)) { Serial.println("Sensor read failed"); return 0.0f; }
    return t;
}

// ── วิธีที่ 1: ผูก callback ใน setup() ──
SynaptaSensor temp("bedroom/temp");

// ── วิธีที่ 2: ระบุ interval + function ใน constructor เลย ──
// SynaptaSensor temp("bedroom/temp", 30000, readTemp);


void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    temp.every(30000, readTemp);   // ตัดออกได้ถ้าใช้วิธีที่ 2
}

void loop() {
    Synapta.loop();
}
