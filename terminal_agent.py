import os
import subprocess
import paho.mqtt.client as mqtt

# ── Config ─────────────────────────────────────────────────────────────────────
# ตั้ง COMPUTER_NAME ให้ตรงกับชื่อที่กรอกตอน Add Terminal ใน web app
# topic จะ generate ให้อัตโนมัติเหมือน widget เลย
#
# Web app ใช้ WebSocket (wss://broker.hivemq.com:8884)
# Python ใช้ TCP ตรงได้เลย — same broker, different transport

BROKER        = "broker.hivemq.com"
PORT          = 8883          # TLS — encrypted
BASE          = "Mylab/smarthome"
COMPUTER_NAME = "office-pc"           # ← ต้องตรงกับชื่อที่ตั้งใน Add Terminal

CMD_TOPIC = f"{BASE}/{COMPUTER_NAME}/cmd"
OUT_TOPIC = f"{BASE}/{COMPUTER_NAME}/output"

# ── Handlers ───────────────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] connected (rc={rc})")
    print(f"[MQTT] listening on  : {CMD_TOPIC}")
    print(f"[MQTT] publishing to : {OUT_TOPIC}")
    client.subscribe(CMD_TOPIC, qos=2)

def on_message(client, userdata, msg):
    command = msg.payload.decode("utf-8").strip()
    print(f"\n$ {command}")

    # cd ต้องอัพเดต working directory ของ process นี้
    if command.lower().startswith("cd"):
        parts = command.split(None, 1)
        path  = parts[1].strip() if len(parts) > 1 else os.path.expanduser("~")
        try:
            os.chdir(path)
            output = os.getcwd()
        except Exception as e:
            output = f"cd: {e}"
    else:
        output = subprocess.getoutput(command)

    print(output or "(no output)")
    client.publish(OUT_TOPIC, output or "(no output)", qos=2)

# ── Main ───────────────────────────────────────────────────────────────────────

client = mqtt.Client(client_id=f"aiot_{COMPUTER_NAME}", protocol=mqtt.MQTTv311)
client.on_connect = on_connect
client.on_message = on_message

print(f"[MQTT] connecting to {BROKER}:{PORT} (TLS) ...")
client.tls_set()              # ใช้ CA bundle ของระบบ — ไม่ต้อง config เพิ่ม
client.connect(BROKER, PORT, keepalive=60)
client.loop_forever()
