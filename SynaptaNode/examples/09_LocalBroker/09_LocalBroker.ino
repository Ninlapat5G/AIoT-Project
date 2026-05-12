/*
 * 09_LocalBroker — Mosquitto / EMQX ที่รันใน LAN (plain MQTT, port 1883)
 *
 * Default ของ library คือ broker.hivemq.com + TLS 8883
 * ถ้าใช้ broker ใน LAN เอง → tls=false + port 1883 จะเร็วและไม่ต้องตั้ง cert
 *
 * Web App: Settings → MQTT → ใส่ broker IP + port 1883 + TLS off เดียวกัน
 */

#include <Synapta.h>

SynaptaDigital relay("bedroom/relay");

void setup() {
    Serial.begin(115200);

    Synapta.wifi("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
    Synapta.broker("192.168.1.100", 1883, false);     // host, port, TLS=false
    Synapta.baseTopic("Mylab/smarthome");
    Synapta.start();
}

void loop() {
    Synapta.loop();
}
