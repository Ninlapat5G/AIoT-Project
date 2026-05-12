#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <vector>
#include <functional>
#include "NodeConfig.h"
#include "SynaptaDevice.h"

class SynaptaNodeClass {
public:
    // ── V1 Config — เรียกใน setup() ก่อน start() ──────────────────────────────
    // ตัวอย่าง:
    //   Synapta.wifi("MYWIFI", "PASSWORD");
    //   Synapta.baseTopic("Mylab/smarthome");
    //   Synapta.start();
    // broker() / mqttAuth() / nodeId() เรียกเฉพาะถ้าต้องการเปลี่ยนจาก default
    SynaptaNodeClass& wifi      (const char* ssid, const char* pass);
    SynaptaNodeClass& broker    (const char* host, int port = 8883, bool tls = true);
    SynaptaNodeClass& mqttAuth  (const char* user, const char* pass);
    SynaptaNodeClass& baseTopic (const char* base);
    SynaptaNodeClass& nodeId    (const char* id);
    void              start();             // เริ่มจริง — เชื่อม WiFi + MQTT

    // ── Legacy API (ยังใช้ได้) ────────────────────────────────────────────────
    void begin(const char* ssid, const char* pass, const char* baseTopic);
    void begin();
    void configure(const char* ssid, const char* pass, const char* baseTopic);

    // ── Runtime ──────────────────────────────────────────────────────────────
    void loop();
    bool isConnected();

    void onConnect   (std::function<void()> cb) { _cbConnect    = cb; }
    void onDisconnect(std::function<void()> cb) { _cbDisconnect = cb; }

    bool _publish(const char* topic, const char* payload, bool retain = true);
    const NodeConfig& config() const { return _cfg; }

private:
    NodeConfig       _cfg;
    WiFiClientSecure _tlsClient;
    WiFiClient       _plainClient;
    PubSubClient     _mqtt;

    std::vector<SynaptaDevice*> _devices;

    std::function<void()> _cbConnect;
    std::function<void()> _cbDisconnect;

    bool     _wasConnected    = false;
    bool     _wifiBeginCalled = false;   // กัน WiFi.begin ซ้ำระหว่าง connecting
    uint32_t _lastReconnectMs = 0;

    void _init();
    void _connectWiFi();        // non-blocking — แค่ trigger WiFi.begin
    bool _connectMQTT();
    void _publishManifest();    // V1: ประกาศ device list ตอน connect

    String _macSuffix()     const;
    String _nodeId()        const;
    String _statusTopic()   const;
    String _manifestTopic() const;

    // PubSubClient requires a static callback
    static void _mqttCallback(char* topic, uint8_t* payload, unsigned int len);
    void _onMessage(char* topic, uint8_t* payload, unsigned int len);
};

extern SynaptaNodeClass Synapta;
