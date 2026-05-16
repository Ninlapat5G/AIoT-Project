import { useState, useCallback, useRef } from 'react'
import { runAgent } from '../utils/mainagent/agent'
import { SKILLS } from '../utils/mainagent/skills'

// helper: หา label ของ step สำหรับ UI
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
  const [livePlan, setLivePlan]     = useState(null)     // {steps}
  const [liveStatuses, setLiveStatuses] = useState([])   // [{status, summary}]

  const abortControllerRef = useRef(null)
  const livePlanSnapshot = useRef({ plan: null, statuses: [] })
  livePlanSnapshot.current = { plan: livePlan, statuses: liveStatuses }

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
    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)
    setLivePlan(null)
    setLiveStatuses([])

    abortControllerRef.current = new AbortController()

    try {
      const { reply } = await runAgent({
        text,
        settings,
        apiHistory,
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
          setLiveStatuses(plan.steps.map(() => ({ status: 'pending' })))
        },

        onStepStart: (index) => {
          setLiveStatuses(prev => prev.map((s, i) =>
            i === index ? { ...s, status: 'running' } : s
          ))
        },

        onStepResult: (index, result) => {
          setLiveStatuses(prev => prev.map((s, i) =>
            i === index
              ? { status: result.ok ? 'ok' : 'fail', summary: result.summary || '' }
              : s
          ))
        },

        onStream: chunk => {
          setThinking(false)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'ai' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + chunk }]
            }
            return [...prev, { role: 'ai', text: chunk, streaming: true }]
          })
        },
      })

      // freeze plan ลง message stream (ก่อน AI message) แล้วเคลียร์ live state
      setMessages(prev => {
        const last = prev[prev.length - 1]
        let base = prev
        let aiMsg = null
        if (last?.role === 'ai' && last?.streaming) {
          aiMsg = { role: 'ai', text: last.text }
          base = prev.slice(0, -1)
        } else if (reply && last?.role !== 'ai') {
          aiMsg = { role: 'ai', text: reply }
        }

        const planMsg = livePlanSnapshot.current.plan
          ? [{
              role: 'plan',
              plan: livePlanSnapshot.current.plan,
              statuses: livePlanSnapshot.current.statuses,
            }]
          : []

        return [
          ...base,
          ...planMsg,
          ...(aiMsg ? [aiMsg] : []),
        ]
      })

      setLivePlan(null)
      setLiveStatuses([])

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
            return [...prev.slice(0, -1), { role: 'ai', text: last.text + '\n\n*— 🛑 หยุดการสร้างข้อความ —*' }]
          }
          return [...prev, { role: 'ai', text: '*— 🛑 ยกเลิกการประมวลผล —*' }]
        })
        return
      }

      setMessages(prev => {
        const last = prev[prev.length - 1]
        const base = last?.streaming ? prev.slice(0, -1) : prev
        return [...base, { role: 'ai', text: `⚠️ ${err.message}` }]
      })
    } finally {
      setThinking(false)
      setLivePlan(null)
      setLiveStatuses([])
    }
  }, [settings, devicesRef, baseTopicRef, setDevices, mqttClient, mqttWaitForStream, handleSaveSettings, apiHistory])

  const clearChat = useCallback(() => {
    stopChat()
    setMessages([])
    setApiHistory([])
  }, [stopChat])

  return {
    messages, thinking, livePlan, liveStatuses, labelOfStep,
    sendMessage, clearChat, stopChat,
  }
}
