#include "SynaptaNode.h"
#include "SynaptaRegistry.h"

SynaptaNodeClass Synapta;

// ── V1 Fluent / step-by-step config ──────────────────────────────────────────

SynaptaNodeClass& SynaptaNodeClass::wifi(const char* ssid, const char* pass) {
    _cfg.wifiSSID     = ssid;
    _cfg.wifiPassword = pass;
    return *this;
}

SynaptaNodeClass& SynaptaNodeClass::broker(const char* host, int port, bool tls) {
    _cfg.mqttBroker = host;
    _cfg.mqttPort   = port;
    _cfg.mqttTLS    = tls;
    return *this;
}

SynaptaNodeClass& SynaptaNodeClass::mqttAuth(const char* user, const char* pass) {
    _cfg.mqttUser     = user;
    _cfg.mqttPassword = pass;
    return *this;
}

SynaptaNodeClass& SynaptaNodeClass::baseTopic(const char* base) {
    _cfg.baseTopic = base;
    return *this;
}

SynaptaNodeClass& SynaptaNodeClass::nodeId(const char* id) {
    _cfg.nodeId = id;
    return *this;
}

void SynaptaNodeClass::start() {
    if (!_cfg.isValid()) {
        Serial.println("[Synapta] ERROR: wifi() and baseTopic() must be set before start()");
        return;
    }
    _init();
}

// ── Legacy API ────────────────────────────────────────────────────────────────

void SynaptaNodeClass::begin(const char* ssid, const char* pass, const char* base) {
    _cfg = NodeConfig(ssid, pass, base);
    _init();
}

void SynaptaNodeClass::begin() {
    _cfg.load();
    if (!_cfg.isValid()) {
        Serial.println("[Synapta] ERROR: no saved credentials. Call configure() first.");
        return;
    }
    _init();
}

void SynaptaNodeClass::configure(const char* ssid, const char* pass, const char* base) {
    _cfg = NodeConfig(ssid, pass, base);
    _cfg.save();
    _init();
}

// ── Init ──────────────────────────────────────────────────────────────────────

void SynaptaNodeClass::_init() {
    Serial.println("[Synapta] Initialising...");

    _devices.clear();
    for (auto* d : _SynaptaRegistry::devices()) {
        _devices.push_back(d);
        // โหลด pin config ที่บันทึกไว้จาก NVS (ถ้ามี)
        d->_loadPinConfig();
    }

    if (_cfg.mqttTLS) {
        _tlsClient.setInsecure();
        _mqtt.setClient(_tlsClient);
    } else {
        _mqtt.setClient(_plainClient);
    }
    _mqtt.setServer(_cfg.mqttBroker.c_str(), _cfg.mqttPort);
    _mqtt.setCallback(_mqttCallback);
    _mqtt.setBufferSize(1024);

    _connectWiFi();
}

// ── Runtime loop ──────────────────────────────────────────────────────────────

void SynaptaNodeClass::loop() {
    if (WiFi.status() != WL_CONNECTED) {
        if (_wasConnected) {
            _wasConnected = false;
            if (_cbDisconnect) _cbDisconnect();
        }
        if (millis() - _lastReconnectMs > 5000) {
            _lastReconnectMs = millis();
            _wifiBeginCalled = false;
            _connectWiFi();
        }
        for (auto* d : _devices) d->_loop();
        return;
    }

    if (!_mqtt.connected()) {
        if (_wasConnected) {
            _wasConnected = false;
            if (_cbDisconnect) _cbDisconnect();
        }
        if (millis() - _lastReconnectMs > 5000) {
            _lastReconnectMs = millis();
            if (_connectMQTT()) {
                _wasConnected = true;
                if (_cbConnect) _cbConnect();
            }
        }
    } else if (!_wasConnected) {
        _wasConnected = true;
        if (_cbConnect) _cbConnect();
    }

    _mqtt.loop();
    for (auto* d : _devices) d->_loop();
}

bool SynaptaNodeClass::isConnected() {
    return _mqtt.connected();
}

bool SynaptaNodeClass::_publish(const char* topic, const char* payload, bool retain) {
    if (!_mqtt.connected()) return false;
    return _mqtt.publish(topic, (const uint8_t*)payload, strlen(payload), retain);
}

// ── WiFi (non-blocking) ───────────────────────────────────────────────────────

void SynaptaNodeClass::_connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    if (_wifiBeginCalled) return;

    Serial.print("[Synapta] WiFi.begin → ");
    Serial.println(_cfg.wifiSSID);
    WiFi.begin(_cfg.wifiSSID.c_str(), _cfg.wifiPassword.c_str());
    _wifiBeginCalled = true;
}

// ── MQTT connect ──────────────────────────────────────────────────────────────

bool SynaptaNodeClass::_connectMQTT() {
    String clientId    = "synapta-" + _macSuffix();
    String statusTopic = _statusTopic();

    Serial.print("[Synapta] MQTT connecting as: ");
    Serial.print(clientId);

    bool ok;
    if (_cfg.mqttUser.isEmpty()) {
        ok = _mqtt.connect(clientId.c_str(), statusTopic.c_str(), 0, true, "offline");
    } else {
        ok = _mqtt.connect(clientId.c_str(),
                           _cfg.mqttUser.c_str(), _cfg.mqttPassword.c_str(),
                           statusTopic.c_str(), 0, true, "offline");
    }

    if (!ok) {
        Serial.print(" failed, rc=");
        Serial.print(_mqtt.state());
        Serial.println(" (will retry)");
        return false;
    }

    Serial.println(" OK");
    _publish(statusTopic.c_str(), "online", true);

    // subscribe ทั้ง command (/set) และ config (/config) ของทุก device
    for (auto* d : _devices) {
        String cmdT = d->_cmdTopic(_cfg.baseTopic);
        String cfgT = d->_configTopic(_cfg.baseTopic);
        _mqtt.subscribe(cmdT.c_str(), 1);
        _mqtt.subscribe(cfgT.c_str(), 1);
        Serial.printf("[Synapta] Subscribed: %s | %s\n", cmdT.c_str(), cfgT.c_str());
    }

    for (auto* d : _devices) d->_reportState();

    _publishManifest();
    return true;
}

// ── Manifest ──────────────────────────────────────────────────────────────────
// publish ไปที่ {base}/nodes/{nodeId}/manifest (retained)
// web app subscribe {base}/nodes/+/manifest เพื่อ discover devices อัตโนมัติ

void SynaptaNodeClass::_publishManifest() {
    String json = "{\"nodeId\":\"";
    json += _nodeId();
    json += "\",\"baseTopic\":\"";
    json += _cfg.baseTopic;
    json += "\",\"devices\":[";
    for (size_t i = 0; i < _devices.size(); i++) {
        if (i > 0) json += ",";
        json += _devices[i]->_manifestEntry(_cfg.baseTopic);
    }
    json += "]}";

    String topic = _manifestTopic();
    bool ok = _publish(topic.c_str(), json.c_str(), true);
    Serial.print("[Synapta] Manifest → ");
    Serial.print(topic);
    Serial.println(ok ? " OK" : " FAILED");
}

// ── MQTT message router ───────────────────────────────────────────────────────

void SynaptaNodeClass::_mqttCallback(char* topic, uint8_t* payload, unsigned int len) {
    Synapta._onMessage(topic, payload, len);
}

void SynaptaNodeClass::_onMessage(char* topic, uint8_t* payload, unsigned int len) {
    String payloadStr = String((char*)payload, len);
    String topicStr   = String(topic);

    for (auto* d : _devices) {
        if (topicStr == d->_cmdTopic(_cfg.baseTopic)) {
            d->_handleMessage(payloadStr.c_str());
            return;
        }
        // config message: pin assignment จาก web app ตอนกด save
        if (topicStr == d->_configTopic(_cfg.baseTopic)) {
            d->_handleConfig(payloadStr.c_str());
            return;
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

String SynaptaNodeClass::_macSuffix() const {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[8];
    snprintf(buf, sizeof(buf), "%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(buf);
}

String SynaptaNodeClass::_nodeId()        const { return _cfg.nodeId.length() > 0 ? _cfg.nodeId : "node-" + _macSuffix(); }
String SynaptaNodeClass::_statusTopic()   const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/status"; }
String SynaptaNodeClass::_manifestTopic() const { return _cfg.baseTopic + "/nodes/" + _nodeId() + "/manifest"; }
