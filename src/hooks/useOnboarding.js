/**
 * useOnboarding — จัดการ state ของ onboarding flow กับ "ซิน"
 *
 * active = true   → ใช้ messages + send จาก hook นี้แทน main chat
 * active = false  → onboarding เสร็จแล้ว ใช้ main chat ปกติ
 *
 * เงื่อนไขปิด:  apiKey ≠ DEFAULT_API_KEY && apiKey ≠ '' && testApiKey() === true
 * Reset:        clearAll() จาก Settings ล้าง sh_onboarding → onboarding กลับมาเอง
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { DEFAULT_API_KEY } from '../config/default_key'
import { loadOnboarding, saveOnboarding } from '../utils/storage'
import { runSin, extractNameFromText, testApiKey } from '../utils/onboardingAgent'

// ── Stage Contexts ─────────────────────────────────────────────────────────────
// ข้อความ system context ที่บอกซินว่าตอนนี้อยู่ขั้นไหน

const STAGE_CONTEXTS = {
  greeting: `[สถานการณ์] นี่คือครั้งแรกที่ user เปิดใช้งาน SynaptaOS
ทักทายสั้นๆ อบอุ่น แนะนำตัวว่าชื่อ "ซิน" เป็น AI ของ SynaptaOS แล้วถามว่า "อยากให้เรียกว่าอะไรดีคะ?"
ตอบสั้นๆ แค่ 2-3 ประโยค ห้ามอธิบายฟีเจอร์หรือ step ใดๆ ในข้อความนี้`,

  awaiting_name: `[สถานการณ์] ซินถามชื่อ user ไปแล้ว ยังไม่ได้รับชื่อที่ชัดเจน
ถ้า user พูดอะไรก็ตาม ให้ตอบตามเนื้อหาของสิ่งที่ user พูดก่อน แล้วค่อยถามชื่ออย่างเป็นธรรมชาติอีกครั้ง
ห้ามเพิกเฉยต่อสิ่งที่ user พูด`,

  got_name: `[สถานการณ์] ซินเพิ่งได้รับชื่อ user มา ระบบบันทึกชื่อไว้แล้ว
ให้ทักทาย user ด้วยชื่อที่ได้รับอย่างอบอุ่น
จากนั้นเรียก inspect_system เพื่อดูสถานะระบบ
แล้วแนะนำ step การตั้งค่าสั้นๆ: ต้องใส่ Typhoon API key ก่อน (สำคัญที่สุด) พร้อมลิงค์ https://playground.opentyphoon.ai/settings/api-key
บอกด้วยว่า Serper API key ช่วยให้ AI ค้นเว็บได้ พร้อมลิงค์ https://serper.dev/api-keys
บอกว่าใช้ key ของระบบได้ก่อนระหว่างรอ`,

  setup: `[สถานการณ์] user ใส่ชื่อแล้ว อยู่ในขั้นตอน setup
ซินช่วยตอบคำถามเกี่ยวกับการตั้งค่าระบบ
ถ้าไม่แน่ใจสถานะระบบปัจจุบัน เรียก inspect_system ก่อน
ถ้า user ถามเรื่องที่ซินทำไม่ได้ (ควบคุมอุปกรณ์ ค้นหาเว็บ) บอกให้ไปหน้า Chat ปกติ`,

  farewell: `[สถานการณ์] user ได้ตั้งค่า Typhoon API key ของตัวเองแล้ว ระบบตรวจสอบแล้วว่าใช้งานได้
ซินจะส่งต่อให้ AI หลัก (ซิน SynaptaOS) ดูแลต่อไป
ให้ส่ง farewell message ที่อบอุ่น น่ารัก ขำๆ นิดนึง
บอกว่าซินออกไปแล้ว AI หลักจะเข้ามาแทน
อาจทิ้ง hint เล็กน้อยเกี่ยวกับ SynaptaOS ที่ทำได้
จบด้วยคำอำลาสั้นๆ น่ารักๆ`,
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOnboarding({ settings, handleSaveSettings, onComplete, onFarewellStart }) {
  const [completed, setCompleted] = useState(() => loadOnboarding()?.completed || false)
  const [stage, setStage] = useState(() => loadOnboarding()?.stage || 'greeting')

  const [messages, setMessages] = useState([])
  const [thinking, setThinking] = useState(false)
  const [apiHistory, setApiHistory] = useState([])

  const greetingTriggered = useRef(false)
  const completingRef = useRef(false)
  const abortRef = useRef(null)
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])
  const onFarewellStartRef = useRef(onFarewellStart)
  useEffect(() => { onFarewellStartRef.current = onFarewellStart }, [onFarewellStart])

  const active = !completed

  // Persist stage
  useEffect(() => {
    if (!completed) saveOnboarding({ completed: false, stage })
  }, [stage, completed])

  // ── Streaming helpers ─────────────────────────────────────────────────────────

  const streamChunk = useCallback((chunk) => {
    setThinking(false)
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role === 'ai' && last?.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + chunk }]
      }
      return [...prev, { role: 'ai', text: chunk, streaming: true }]
    })
  }, [])

  const finalizeStream = useCallback(() => {
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.streaming) return [...prev.slice(0, -1), { role: 'ai', text: last.text }]
      return prev
    })
  }, [])

  // ── Farewell + Deactivation ───────────────────────────────────────────────────

  const runFarewell = useCallback(async () => {
    onFarewellStartRef.current?.()
    setThinking(true)
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    try {
      await runSin({
        stageContext: STAGE_CONTEXTS.farewell,
        userMessage: null,
        apiHistory,
        settings: settingsRef.current,
        signal: abortRef.current.signal,
        onStream: streamChunk,
      })
      finalizeStream()
      await new Promise(r => setTimeout(r, 1500))
    } catch (e) {
      if (e.name !== 'AbortError') {
        finalizeStream()
        setMessages(prev => [...prev, { role: 'ai', text: 'ขอบคุณนะคะ ยินดีด้วย! ซินออกไปแล้ว AI หลักจะดูแลต่อนะคะ 🌸' }])
        await new Promise(r => setTimeout(r, 1200))
      }
    } finally {
      setThinking(false)
      setCompleted(true)
      saveOnboarding({ completed: true, stage: 'done' })
      onComplete?.()
    }
  }, [apiHistory, streamChunk, finalizeStream, onComplete])

  useEffect(() => {
    if (completed || completingRef.current) return
    const key = settings.apiKey
    if (!key || key === DEFAULT_API_KEY) return

    completingRef.current = true
    testApiKey(key, settings.endpoint, settings.model).then(ok => {
      if (!ok) { completingRef.current = false; return }
      runFarewell()
    })
  }, [settings.apiKey]) // eslint-disable-line

  // ── Auto-greeting ─────────────────────────────────────────────────────────────

  const triggerGreeting = useCallback(async () => {
    if (greetingTriggered.current || !active) return
    // If user already has their own key, deactivation effect handles transition — skip intro
    const key = settingsRef.current?.apiKey
    if (key && key !== DEFAULT_API_KEY) return
    greetingTriggered.current = true
    setThinking(true)

    abortRef.current = new AbortController()
    let greetingReply = ''
    try {
      await runSin({
        stageContext: STAGE_CONTEXTS.greeting,
        userMessage: null,
        apiHistory: [],
        settings: settingsRef.current,
        signal: abortRef.current.signal,
        onStream: chunk => {
          greetingReply += chunk
          streamChunk(chunk)
        },
      })
      finalizeStream()
      // บันทึก greeting ลง history เพื่อให้ turn ถัดไปมี context
      if (greetingReply) setApiHistory([{ role: 'assistant', content: greetingReply }])
      setStage('awaiting_name')
    } catch (e) {
      if (e.name !== 'AbortError') {
        finalizeStream()
        const fallback = 'สวัสดีค่ะ! หนูชื่อซิน AI ของ SynaptaOS 🌟 อยากให้เรียกว่าอะไรดีคะ?'
        setMessages(prev => [...prev, { role: 'ai', text: fallback }])
        setApiHistory([{ role: 'assistant', content: fallback }])
        setStage('awaiting_name')
      }
    } finally {
      setThinking(false)
    }
  }, [active, streamChunk, finalizeStream])

  // ── Send message ──────────────────────────────────────────────────────────────

  const send = useCallback(async (text) => {
    if (!active || thinking) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    const currentSettings = settingsRef.current
    let currentStage = stage

    try {
      // ── Name extraction stage ──────────────────────────────────────────────
      if (stage === 'awaiting_name') {
        const { name, initials } = await extractNameFromText(text, currentSettings)
        if (name) {
          const newBio = `ชื่อ ${name}`
          if (newBio !== currentSettings.profile?.userBio || name !== currentSettings.profile?.displayName) {
            handleSaveSettings({
              ...currentSettings,
              profile: { ...currentSettings.profile, userBio: newBio, displayName: name, displayInitials: initials },
            })
          }
          currentStage = 'got_name'
          setStage('setup')
        }
        // If no name extracted, stay in awaiting_name — context handles natural re-ask
      }

      const stageCtx = STAGE_CONTEXTS[currentStage] || STAGE_CONTEXTS.setup
      let reply = ''

      await runSin({
        stageContext: stageCtx,
        userMessage: text,
        apiHistory,
        settings: currentSettings,
        signal: abortRef.current.signal,
        onStream: chunk => {
          reply += chunk
          streamChunk(chunk)
        },
      })
      finalizeStream()

      setApiHistory(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ].slice(-20))

    } catch (e) {
      finalizeStream()
      if (e.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${e.message}` }])
      }
    } finally {
      setThinking(false)
    }
  }, [active, thinking, stage, apiHistory, handleSaveSettings, streamChunk, finalizeStream])

  return { active, stage, messages, thinking, send, triggerGreeting }
}
