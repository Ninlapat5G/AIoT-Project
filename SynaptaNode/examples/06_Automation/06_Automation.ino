/*
 * 06_Automation — sensor → actuator แบบ rule บน node เลย
 *
 * อ่านอุณหภูมิทุก 5 วินาที:
 *   t > 30°C  → เปิดพัดลม
 *   t < 28°C  → ปิดพัดลม
 * (hysteresis 2°C กันเปิด-ปิดถี่)
 *
 * ทั้ง sensor + relay sync ไป Web App ตามปกติ
 *
 * Wiring: DHT22 DATA → GPIO 15
 * Pin assignment: Web App → Edit "bedroom/fan" → ใส่ Pin → Save
 * Library required: "DHT sensor library" by Adafruit
 */

#include <Synapta.h>
#include <DHT.h>

DHT dht(15, DHT22);

SynaptaSensor  temp("bedroom/temp");
SynaptaDigital fan ("bedroom/fan");

float readTemp() {
    float t = dht.readTemperature();
    if (isnan(t)) return temp.read();   // อ่านไม่ได้ → ใช้ค่าเก่า ไม่ apply rule

    if (t > 30 && !fan.isOn()) fan.turnOn();
    if (t < 28 &&  fan.isOn()) fan.turnOff();

    return t;
}

void setup() {
    Serial.begin(115200);
    dht.begin();

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();

    temp.every(5000, readTemp);
}

void loop() {
    Synapta.loop();
}
