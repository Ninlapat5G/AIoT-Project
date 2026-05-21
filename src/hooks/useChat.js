import { useState, useCallback, useRef } from 'react'
import { runAgent } from '../utils/mainagent/agent'
import { SKILLS } from '../utils/mainagent/skills'

function labelOfStep(step) {
  const skill = SKILLS[step?.type]
  if (skill?.label) {
    try { return skill.label(step) } catch { /* fall through */ }
  }
  return step?.type || 'step'
}

export function useChat({
  settings, devicesRef, baseTopicRef, setDevices,
  mqttClient, mqttWaitForStream, handleSaveSettings,
}) {
  const [messages, setMessages]     = useState([])
  const [apiHistory, setApiHistory] = useState([])
  const [thinking, setThinking]     = useState(false)

  // เก็บ livePlan ไว้ให้ UI ใช้เช็คปุ่ม Stop (X) แต่เราจะไม่เอามันไปวาดแยกซ้อนทับแล้ว
  const [livePlan, setLivePlan]     = useState(null)
  const [liveStatuses, setLiveStatuses] = useState([])

  const abortControllerRef = useRef(null)
  const lastCommandRef     = useRef(null)
  const chatSummaryRef     = useRef('')
  const pendingAnswerRef   = useRef('')

  const stopChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setThinking(false)
    setLivePlan(null)
    setLiveStatuses([])
  }, [])

  const sendMessage = useCallback(async text => {
    const userMsgId = 'u-' + Date.now()
    setMessages(prev => [...prev, { _id: userMsgId, role: 'user', text }])
    setThinking(true)
    setLivePlan(null)
    setLiveStatuses([])

    abortControllerRef.current = new AbortController()
    let currentPlanId = null

    try {
      const { reply, lastCommand, chat_summary, pending_answer } = await runAgent({
        text,
        settings,
        apiHistory,
        lastCommand:    lastCommandRef.current,
        chat_summary:   chatSummaryRef.current,
        pending_answer: pendingAnswerRef.current,
        devicesRef,
        baseTopicRef,
        setDevices,
        mqttClient,
        mqttWaitForStream,
        handleSaveSettings,
        signal: abortControllerRef.current.signal,

        onPlanReady: (plan) => {
          setThinking(false)
          setLivePlan(plan)
          const initStatuses = plan.steps.map(() => ({ status: 'pending' }))
          setLiveStatuses(initStatuses)

          currentPlanId = 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
          const pid = currentPlanId
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'interim'),
            { _id: pid, role: 'plan', plan, statuses: initStatuses }
          ])
        },

        onInterimStatus: (verb) => {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'interim'),
            { _id: 'i-' + Date.now(), role: 'interim', text: verb }
          ])
        },

        onStepStart: (index) => {
          setLiveStatuses(prev => prev.map((s, i) => i === index ? { ...s, status: 'running' } : s))
          const pid = currentPlanId
          if (!pid) return
          setMessages(prev => prev.map(m =>
            m._id === pid
              ? { ...m, statuses: m.statuses.map((s, i) => i === index ? { ...s, status: 'running' } : s) }
              : m
          ))
        },

        onStepResult: (index, result) => {
          setLiveStatuses(prev => prev.map((s, i) => i === index ? { status: result.ok ? 'ok' : 'fail', summary: result.summary || '' } : s))
          const pid = currentPlanId
          if (!pid) return
          setMessages(prev => prev.map(m =>
            m._id === pid
              ? { ...m, statuses: m.statuses.map((s, i) => i === index ? { status: result.ok ? 'ok' : 'fail', summary: result.summary || '' } : s) }
              : m
          ))
        },

        onStream: chunk => {
          setThinking(false)
          setMessages(prev => {
            const base = prev.filter(m => m.role !== 'interim')
            const last = base[base.length - 1]
            if (last?.role === 'ai' && last?.streaming) {
              return [...base.slice(0, -1), { ...last, text: last.text + chunk }]
            }
            return [...base, { _id: 'a-' + Date.now(), role: 'ai', text: chunk, streaming: true }]
          })
        },

        // graph ตอบ user เสร็จแล้ว — finalize message ทันที ก่อน memory จะรัน
        onComplete: () => {
          setMessages(prev => {
            const cleaned = prev.filter(m => m.role !== 'interim')
            const last = cleaned[cleaned.length - 1]
            if (last?.role === 'ai' && last?.streaming) {
              return [...cleaned.slice(0, -1), { ...last, streaming: false }]
            }
            return cleaned
          })
          setLivePlan(null)
          setLiveStatuses([])
        },
      })

      // onComplete ทำ finalize + clear livePlan ไปแล้ว
      // แต่ถ้า streaming ไม่เกิด (เช่น error ก่อน stream) ให้ fallback ใส่ reply ด้วย
      if (reply) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'ai') return prev   // onComplete จัดไปแล้ว
          return [...prev.filter(m => m.role !== 'interim'),
                  { _id: 'a-' + Date.now(), role: 'ai', text: reply }]
        })
      }

      if (lastCommand !== null) lastCommandRef.current = lastCommand
      chatSummaryRef.current   = chat_summary   ?? ''
      pendingAnswerRef.current = pending_answer ?? ''

      setApiHistory(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ].slice(-30))

    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'ai' && last?.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + '\n\n*— 🛑 หยุดการสร้างข้อความ —*', streaming: false }]
          }
          return [...prev, { _id: 'e-' + Date.now(), role: 'ai', text: '*— 🛑 ยกเลิกการประมวลผล —*' }]
        })
        return
      }

      setMessages(prev => {
        const last = prev[prev.length - 1]
        const base = last?.streaming ? prev.slice(0, -1) : prev
        return [...base, { _id: 'e-' + Date.now(), role: 'ai', text: `⚠️ ${err.message}` }]
      })
    } finally {
      setThinking(false)
      setLivePlan(null)
      setLiveStatuses([])
      setMessages(prev => prev.filter(m => m.role !== 'interim'))
    }
  }, [settings, devicesRef, baseTopicRef, setDevices, mqttClient, mqttWaitForStream, handleSaveSettings, apiHistory])

  const clearChat = useCallback(() => {
    stopChat()
    setMessages([])
    setApiHistory([])
    lastCommandRef.current     = null
    chatSummaryRef.current     = ''
    pendingAnswerRef.current   = ''
  }, [stopChat])

  return {
    messages, thinking, livePlan, liveStatuses, labelOfStep,
    sendMessage, clearChat, stopChat,
  }
}
