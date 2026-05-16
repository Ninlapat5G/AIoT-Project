// hub_control — สั่ง task ให้ hub device (มี agent ของตัวเอง)
//
// step shape: { type: 'hub_control', device, topic, task }

import { findDeviceByTopic } from '../../kg.js'
import { normalizeBase, buildCmdTopic, buildStateTopic } from '../../mqttTopic.js'

export const hubControl = {
  type: 'hub_control',
  requiresSkill: 'hub',

  planPrompt: `hub_control — ส่ง task ไปให้ hub device (เครื่องคอมพิวเตอร์/Pi ที่มี agent)
- ใช้กับ device type "hub" เท่านั้น
- task เป็นภาษาธรรมชาติ ตรงตามที่ user สั่งเลย (hub agent จะตีความเอง)
- ตัวอย่างงานที่ส่ง hub: shutdown, restart, เช็ค CPU, เปิดแอป, ค้นไฟล์, รันคำสั่ง

ห้าม:
- ใช้ hub_control กับ device ที่ไม่ใช่ hub (ใช้ home_control)
- web_search ก่อน — hub agent ทำเองได้`,

  example: `{"type": "hub_control", "device": "Main Hub", "topic": "hub/main", "task": "เช็ค CPU usage"}`,

  async execute(step, ctx) {
    const { mqttClient, devicesRef, baseTopicRef, mqttWaitForStream, signal } = ctx
    const { topic, task } = step

    if (!mqttClient)  return { ok: false, summary: `✗ Hub: MQTT ไม่เชื่อมต่อ` }
    if (!task)        return { ok: false, summary: `✗ Hub: ขาด task ใน step` }
    if (!topic)       return { ok: false, summary: `✗ Hub: ขาด topic ใน step` }

    const device = findDeviceByTopic(devicesRef.current || [], topic)
    if (!device || device.type !== 'hub') {
      return { ok: false, summary: `✗ Hub: ไม่พบ hub device ที่ topic ${topic}` }
    }

    const base = normalizeBase(baseTopicRef.current)
    const cmdTopic    = buildCmdTopic(device.topic, base).replace(/\/set$/, '/cmd')
    const outputTopic = buildStateTopic(device.topic, base).replace(/\/state$/, '/output')
    const cancelTopic = buildCmdTopic(device.topic, base).replace(/\/set$/, '/cancel')

    signal?.addEventListener('abort', () => {
      mqttClient.publish(cancelTopic, 'cancel', { qos: 1 })
    }, { once: true })

    const streamPromise = mqttWaitForStream(outputTopic, 60000, {
      ackMsg: '(mqtt_start)', ackTimeoutMs: 5000,
    })

    try {
      await new Promise((resolve, reject) =>
        mqttClient.publish(cmdTopic, task, { qos: 2 }, err => err ? reject(err) : resolve())
      )
    } catch (err) {
      return { ok: false, summary: `✗ ${device.name}: ${err.message}` }
    }

    const { chunks, timedOut, ackTimedOut } = await streamPromise

    if (ackTimedOut) {
      return {
        ok: false,
        summary: `✗ ${device.name}: ติดต่อไม่ได้ — hub อาจปิดเครื่องหรือเน็ตหลุด`,
      }
    }

    const output = chunks.join('\n')
    const note = timedOut ? '\n\n⚠️ ไม่ได้รับ (mqtt_end) — hub อาจขาดการเชื่อมต่อ' : ''
    return {
      ok: true,
      summary: `${device.name} (${task}): ${output || '(no output)'}${note}`,
      device: device.name,
    }
  },

  label(step) {
    const task = step.task ? `: ${String(step.task).slice(0, 30)}` : ''
    return `Hub ${step.device || ''}${task}`
  },
}
