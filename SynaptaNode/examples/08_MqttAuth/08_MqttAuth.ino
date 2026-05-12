/*
 * 08_MqttAuth — เชื่อม broker ที่ต้องการ username + password
 *
 * Production broker ส่วนใหญ่ (HiveMQ Cloud, EMQX, Mosquitto+ACL)
 * ต้องการ auth — ไม่ใช่ public broker
 *
 * Web App: Settings → MQTT → ใส่ broker + user/pass เดียวกัน
 */

#include <Synapta.h>

SynaptaDigital relay("bedroom/relay");

void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.broker("your.broker.com", 8883, true);          // host, port, TLS
    Synapta.mqttAuth("YOUR_MQTT_USER", "YOUR_MQTT_PASS");
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();
}

void loop() {
    Synapta.loop();
}
