/**
 * useOnboarding — จัดการ state ของ onboarding flow กับ "ซิน"
 *
 * active = true   → ใช้ messages + send จาก hook นี้แทน main chat
 * active = false  → onboarding เสร็จแล้ว ใช้ main chat ปกติ
 *
 * เงื่อนไขปิด: apiKey ≠ DEFAULT_API_KEY && apiKey ≠ '' && testApiKey() === true
 * Reset:       clearAll() จาก Settings ล้าง sh_onboarding → onboarding กลับมาเอง
 *
 * Stage และ userName ถูกจัดการโดย graph ใน onboardingAgent.js
 * hook นี้แค่เก็บ state ระหว่าง invocations และ trigger farewell
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { DEFAULT_API_KEY } from '../config/default_key'
import { loadOnboarding, saveOnboarding } from '../utils/storage'
import { runSin, testApiKey } from '../utils/onboarding/onboarding'
import { runGreet } from '../utils/onboarding/greet'

export function useOnboarding({ settings, handleSaveSettings, devicesRef, onComplete, onFarewellStart }) {
  const [completed,  setCompleted]  = useState(() => loadOnboarding()?.completed || false)
  const [stage,      setStage]      = useState(() => loadOnboarding()?.stage    || 'intro')
  const [userName,   setUserName]   = useState(() => loadOnboarding()?.userName || '')

  const [messages,  setMessages]  = useState([])
  const [thinking,  setThinking]  = useState(false)
  const [apiHistory, setApiHistory] = useState([])

  const greetingTriggered = useRef(false)
  const completingRef     = useRef(false)
  const abortRef          = useRef(null)
  const settingsRef       = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])
  const onFarewellStartRef = useRef(onFarewellStart)
  useEffect(() => { onFarewellStartRef.current = onFarewellStart }, [onFarewellStart])

  const active = !completed

  // Persist state
  useEffect(() => {
    if (!completed) saveOnboarding({ completed: false, stage, userName })
  }, [stage, userName, completed])

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
        userMessage: null,
        apiHistory,
        userName,
        stage: 'farewell',
        settings: settingsRef.current,
        devicesRef,
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
      saveOnboarding({ completed: true, stage: 'done', userName })
      onComplete?.()
    }
  }, [apiHistory, userName, streamChunk, finalizeStream, onComplete])

  // ── Farewell trigger เมื่อ user ใส่ API key ที่ใช้งานได้ ─────────────────────

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
    const key = settingsRef.current?.apiKey
    if (key && key !== DEFAULT_API_KEY) return
    greetingTriggered.current = true
    setThinking(true)

    abortRef.current = new AbortController()
    try {
      const { reply } = await runGreet({
        settings: settingsRef.current,
        signal: abortRef.current.signal,
        onStream: streamChunk,
      })
      finalizeStream()
      if (reply) setApiHistory([{ role: 'assistant', content: reply }])
    } catch (e) {
      if (e.name !== 'AbortError') {
        finalizeStream()
        const fallback = 'สวัสดีค่ะ! หนูชื่อซิน AI ของ SynaptaOS 🌟 ขอทราบชื่อเธอหน่อยได้มั้ยคะ?'
        setMessages(prev => [...prev, { role: 'ai', text: fallback }])
        setApiHistory([{ role: 'assistant', content: fallback }])
      }
    } finally {
      setThinking(false)
    }
  }, [active, streamChunk, finalizeStream]) // eslint-disable-line

  // ── Send message ──────────────────────────────────────────────────────────────

  const send = useCallback(async (text) => {
    if (!active || thinking) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    try {
      let reply = ''
      const result = await runSin({
        userMessage: text,
        apiHistory,
        userName,
        stage,
        settings: settingsRef.current,
        devicesRef,
        signal: abortRef.current.signal,
        onStream: chunk => {
          reply += chunk
          streamChunk(chunk)
        },
      })
      finalizeStream()

      // รับ userName และ stage จาก graph
      if (result.userName && result.userName !== userName) {
        setUserName(result.userName)
        // บันทึกลง settings ถ้าได้ชื่อจริง
        if (result.userName !== 'ไม่ระบุ') {
          const name = result.userName
          handleSaveSettings({
            ...settingsRef.current,
            profile: {
              ...settingsRef.current.profile,
              userBio:         `ชื่อ ${name}`,
              displayName:     name,
              displayInitials: name[0]?.toUpperCase() || '',
            },
          })
        }
      }
      if (result.stage && result.stage !== stage) setStage(result.stage)

      setApiHistory(prev => [
        ...prev,
        { role: 'user',      content: text  },
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
  }, [active, thinking, stage, userName, apiHistory, handleSaveSettings, streamChunk, finalizeStream])

  return { active, stage, messages, thinking, send, triggerGreeting }
}
