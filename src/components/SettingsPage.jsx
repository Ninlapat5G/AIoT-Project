import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Icon from './ui/Icon'
import Toggle from './ui/Toggle'
import CfgSharePanel from './CfgSharePanel'
import { saveDevices, loadDevices, saveAreas, loadAreas } from '../utils/storage'

const MQTT_STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'BROKER ONLINE · QoS 1 · MQTT 5 · real-time subscribed',
  reconnecting: 'Reconnecting…',
  error: 'Connection Error',
  offline: 'Offline',
}

const MQTT_DOT_STYLE = {
  connecting: { background: 'var(--ink-xdim)', animation: 'pulse-dot 1s ease-in-out infinite' },
  connected: { background: 'var(--accent)', animation: 'pulse-dot 2s ease-in-out infinite' },
  reconnecting: { background: 'oklch(0.75 0.18 55)', animation: 'pulse-dot 1s ease-in-out infinite' },
  error: { background: 'oklch(0.65 0.22 25)', animation: 'none' },
  offline: { background: 'var(--ink-xdim)', animation: 'none' },
}

export default function SettingsPage({ settings, onSave, mqttStatus = 'offline', onClearAll,
  mqttPublish, mqttWaitForMessage, sensorCache }) {
  const [s, setS] = useState(settings)

  useEffect(() => { setS(settings) }, [settings])

  const save = updater => setS(p => { const u = updater(p); onSave(u); return u })

  const set    = (k, v)       => save(p => ({ ...p, [k]: v }))
  const setMq  = (k, v)       => save(p => ({ ...p, mqtt: { ...p.mqtt, [k]: v } }))
  const setPro = (k, v)       => save(p => ({ ...p, profile: { ...p.profile, [k]: v } }))

  const toggleSkill  = id       => save(p => ({ ...p, skills: p.skills.map(sk => sk.id === id ? { ...sk, enabled: !sk.enabled } : sk) }))
  const updateSkill  = (id, patch) => save(p => ({ ...p, skills: p.skills.map(sk => sk.id === id ? { ...sk, ...patch } : sk) }))
  const removeSkill  = id       => save(p => ({ ...p, skills: p.skills.filter(sk => sk.id !== id) }))

  const addSkill = () => {
    const id = 'skill-' + Date.now().toString(36)
    save(p => ({
      ...p,
      skills: [...p.skills, { id, name: 'new_tool', description: 'Describe what this tool does.', enabled: true, schema: '{"type":"object","properties":{}}' }],
    }))
  }

  const handleClearAll = () => {
    if (window.confirm('ลบข้อมูลทั้งหมด (Settings, Devices, Areas) ออกจาก localStorage?\nแอปจะรีโหลดและกลับสู่ค่าเริ่มต้น')) {
      onClearAll?.()
    }
  }

  const exportData = () => {
    try {
      const allData = {
        settings: s,
        devices: loadDevices() || [],
        areas: loadAreas() || [],
      }
      navigator.clipboard.writeText(JSON.stringify(allData, null, 2))
      alert('คัดลอกข้อมูล JSON ลง Clipboard เรียบร้อยแล้วฮะ! 🚀')
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการคัดลอก: ' + err.message)
    }
  }

  const importData = async () => {
    const apply = data => {
      if (data.settings) { setS(data.settings); onSave(data.settings) }
      if (data.devices) saveDevices(data.devices)
      if (data.areas) saveAreas(data.areas)
      alert('โหลดข้อมูลสำเร็จแล้วฮะ! 🚀')
    }
    try {
      const text = await navigator.clipboard.readText()
      if (!text) throw new Error('Clipboard ว่างเปล่า')
      apply(JSON.parse(text))
    } catch {
      const manualText = prompt('เบราว์เซอร์นี้ไม่อนุญาตให้ดึงข้อมูลจาก Clipboard อัตโนมัติฮะ\n\nโปรดวางโค้ด JSON ด้วยตัวเองตรงนี้เลย:')
      if (manualText) {
        try { apply(JSON.parse(manualText)) }
        catch { alert('โค้ด JSON ไม่ถูกต้องฮะ ลองเช็คดูอีกทีน้า 🥺') }
      }
    }
  }

  const dotStyle = MQTT_DOT_STYLE[mqttStatus] ?? MQTT_DOT_STYLE.offline
  const dotLabel = MQTT_STATUS_LABEL[mqttStatus] ?? 'Unknown'

  return (
    <motion.div
      className="sh-settings-page"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="sh-settings-frame">
        <div className="sh-page-head">
          <div>
            <div className="sh-eyebrow mono">SYSTEM · CONFIGURATION</div>
            <h1>Settings</h1>
            <p className="sh-page-sub">ค่าต่างๆ ถูกบันทึกใน localStorage ของเบราว์เซอร์</p>
          </div>
        </div>

        <div className="sh-settings-body">
          {/* 01 Profile */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">01</div>
              <div><h3>Profile</h3><p>แนะนำตัวเองกับ AI เพื่อให้ตอบกลับได้ตรงใจกว่าเดิม</p></div>
            </div>
            <div className="sh-field">
              <label className="mono">แนะนำตัวกับ AI</label>
              <textarea
                rows={3}
                value={s.profile?.userBio || ''}
                onChange={e => setPro('userBio', e.target.value)}
                placeholder={'ชื่อ Mira · ชอบให้ตอบสั้นๆ · ใช้แอปควบคุมบ้าน 3 ห้อง'}
              />
            </div>
            <div className="sh-builtin-note mono" style={{ marginTop: 4 }}>
              <Icon name="sparkle" size={11} /> ชื่อ Assistant ตรวจจับจาก System Prompt อัตโนมัติ · ปัจจุบัน: <strong>{s.profile?.assistantName || 'Assistant'}</strong>
            </div>
          </section>

          {/* 02 Language Model */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">02</div>
              <div><h3>Language Model</h3><p>Endpoint ที่ใช้สื่อสารกับ AI — รองรับ OpenAI-compatible API</p></div>
            </div>
            <div className="sh-field">
              <label className="mono">API Endpoint</label>
              <input
                value={s.endpoint}
                onChange={e => set('endpoint', e.target.value)}
                placeholder="https://api.opentyphoon.ai/v1"
              />
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label className="mono" style={{ marginBottom: 0 }}>API Key</label>
                  <a
                    href="https://playground.opentyphoon.ai/settings/api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
                  >
                    <Icon name="external" size={9} /> รับ API Key
                  </a>
                </div>
                <input
                  type="password"
                  value={s.apiKey}
                  onChange={e => set('apiKey', e.target.value)}
                  placeholder="sk-•••••••••••••••••"
                />
              </div>
              <div className="sh-field">
                <label className="mono">Model</label>
                <input
                  value={s.model || ''}
                  onChange={e => set('model', e.target.value)}
                  placeholder="typhoon-v2-70b-instruct"
                />
              </div>
            </div>
            <div className="sh-field">
              <label className="mono">System Prompt</label>
              <textarea rows={6} value={s.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} />
            </div>
            <div className="sh-skill-head" style={{ marginTop: 8 }}>
              <div className="sh-skill-meta">
                <div className="sh-skill-name mono">แสดงรายละเอียด Tool Call</div>
                <div className="sh-skill-desc">
                  {(s.showToolDetails ?? true)
                    ? 'แสดง tool name, args, result ทุก call — ปิดเพื่อให้ AI สรุปเป็นประโยคแทน'
                    : 'AI จะสรุปทุก action ในรอบเป็น 1 ประโยค เช่น "เปิดไฟทั้งหมดในบ้าน"'}
                </div>
              </div>
              <Toggle on={s.showToolDetails ?? true} onChange={v => set('showToolDetails', v)} />
            </div>
          </section>

          {/* 03 Skills */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">03</div>
              <div>
                <h3>
                  Skills{' '}
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-xdim)', marginLeft: 6 }}>
                    {s.skills?.filter(x => x.enabled).length || 0}/{s.skills?.length || 0} ENABLED
                  </span>
                </h3>
                <p>Tools เสริมที่ AI เรียกได้ · <strong>mqtt_publish</strong> ควบคุมอุปกรณ์แบบ real-time</p>
              </div>
            </div>
            <div className="sh-builtin-note mono">
              <Icon name="bolt" size={11} /> Built-in (ทำงานอัตโนมัติ ไม่ต้องเปิด): อ่านรายการและสถานะอุปกรณ์จาก Knowledge Graph
            </div>
            <div className="sh-skills">
              {(s.skills || []).map(sk => (
                <div key={sk.id} className={`sh-skill ${sk.enabled ? 'on' : 'off'}`}>
                  <div className="sh-skill-head">
                    <div className="sh-skill-meta">
                      <div className="sh-skill-name mono">{sk.name}</div>
                      <div className="sh-skill-desc">{sk.description}</div>
                    </div>
                    <Toggle on={sk.enabled} onChange={() => toggleSkill(sk.id)} />
                  </div>
                  <details className="sh-skill-details">
                    <summary className="mono">Edit definition</summary>
                    <div className="sh-grid2 mt-2">
                      <div className="sh-field">
                        <label className="mono">Name</label>
                        <input value={sk.name} onChange={e => updateSkill(sk.id, { name: e.target.value })} />
                      </div>
                      <div className="sh-field">
                        <label className="mono">&nbsp;</label>
                        <button className="sh-card-remove" onClick={() => removeSkill(sk.id)}>Remove skill</button>
                      </div>
                    </div>
                    <div className="sh-field">
                      <label className="mono">Description</label>
                      <input value={sk.description} onChange={e => updateSkill(sk.id, { description: e.target.value })} />
                    </div>
                    <div className="sh-field">
                      <label className="mono">JSON Schema (parameters)</label>
                      <textarea
                        rows={3}
                        value={sk.schema}
                        onChange={e => updateSkill(sk.id, { schema: e.target.value })}
                        className="font-mono text-[11px]"
                      />
                    </div>
                  </details>
                </div>
              ))}
              <button className="sh-skill-add" onClick={addSkill}>
                <Icon name="plus" size={14} /> Add skill
              </button>
            </div>
          </section>

          {/* 04 Integrations */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">04</div>
              <div><h3>Integrations</h3><p>API Keys สำหรับ skills ที่ต้องการบริการภายนอก</p></div>
            </div>
            <div className="sh-field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="mono" style={{ marginBottom: 0 }}>
                  Serper API Key
                  <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-xdim)', fontWeight: 400 }}>
                    web_search skill · Free tier: 2,500 queries
                  </span>
                </label>
                <a
                  href="https://serper.dev/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono"
                  style={{ fontSize: 10, color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
                >
                  <Icon name="external" size={9} /> รับ API Key
                </a>
              </div>
              <input
                type="password"
                value={s.serperApiKey || ''}
                onChange={e => set('serperApiKey', e.target.value)}
                placeholder="•••••••••••••••••••••••••••••••••••••••••"
              />
            </div>
          </section>

          {/* 05 MQTT Broker */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">05</div>
              <div><h3>MQTT Broker</h3><p>Event bus สำหรับรับ/ส่งสัญญาณอุปกรณ์ แบบ real-time · QoS 1 · MQTT 5</p></div>
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <label className="mono">Broker URL</label>
                <input value={s.mqtt.broker} onChange={e => setMq('broker', e.target.value)} />
              </div>
              <div className="sh-field">
                <label className="mono">Port</label>
                <input value={s.mqtt.port} onChange={e => setMq('port', e.target.value)} />
              </div>
            </div>
            <div className="sh-field">
              <label className="mono">Base Topic</label>
              <input value={s.mqtt.baseTopic || ''} onChange={e => setMq('baseTopic', e.target.value)} />
            </div>
            <div className="sh-status-row mono">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                style={dotStyle}
              />
              {dotLabel}
            </div>
          </section>

          {/* 06 Share Configuration */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">06</div>
              <div>
                <h3>Share Configuration</h3>
                <p>ย้าย Settings, Devices และ Areas ข้ามเครื่อง — แบบ JSON หรือส่งแบบไร้สายด้วย PIN</p>
              </div>
            </div>
            <div className="sh-grid2">
              <div className="sh-field">
                <label className="mono" style={{ marginBottom: 4 }}>Export JSON</label>
                <button className="sh-btn-ghost w-full" style={{ justifyContent: 'center', height: 40 }} onClick={exportData}>
                  <Icon name="copy" size={14} /> Copy Config JSON
                </button>
              </div>
              <div className="sh-field">
                <label className="mono" style={{ marginBottom: 4 }}>Import JSON</label>
                <button className="sh-btn-ghost w-full" style={{ justifyContent: 'center', height: 40 }} onClick={importData}>
                  <Icon name="upload" size={14} /> Paste JSON
                </button>
              </div>
            </div>
            <div className="sh-share-divider mono">— ส่งแบบไร้สาย (เข้ารหัส AES-GCM · หมดอายุ 5 นาที) —</div>
            <CfgSharePanel
              settings={s}
              onSave={onSave}
              mqttPublish={mqttPublish}
              mqttWaitForMessage={mqttWaitForMessage}
              sensorCache={sensorCache}
            />
          </section>

          {/* 07 Data */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">07</div>
              <div>
                <h3>Data</h3>
                <p>จัดการข้อมูลที่บันทึกไว้ใน localStorage — Settings, Devices, Areas</p>
              </div>
            </div>
            <button className="sh-card-remove" style={{ maxWidth: 220 }} onClick={handleClearAll}>
              Clear all local data
            </button>
          </section>

          {/* 08 Developer Tools */}
          <section className="sh-sect">
            <div className="sh-sect-head">
              <div className="sh-sect-num mono">08</div>
              <div>
                <h3>Developer Tools</h3>
                <p>เครื่องมือสำหรับทดสอบ MQTT 5 flow โดยไม่ต้องมี hardware จริง</p>
              </div>
            </div>
            <div className="sh-field" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 500 }}>IoT Simulator</div>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>
                  เพิ่มตัวเลือก Simulate ใน Add tile เพื่อจำลองอุปกรณ์ ESP32
                </div>
              </div>
              <Toggle
                on={s.devTools ?? false}
                onChange={v => set('devTools', v)}
              />
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  )
}
