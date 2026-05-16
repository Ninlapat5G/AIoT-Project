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
  const lastCommandRef = useRef(null)

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
    const planMsgId = 'p-' + Date.now()

    try {
      const { reply, lastCommand } = await runAgent({
        text,
        settings,
        apiHistory,
        lastCommand: lastCommandRef.current,
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
          
          // 🛑 1. ยัด Tool Pill ลงในประวัติแชทตั้งแต่วินาทีแรก! ไม่มีร่างจำแลงอีกต่อไป!
          setMessages(prev => [
            ...prev,
            { _id: planMsgId, role: 'plan', plan, statuses: initStatuses }
          ])
        },

        onStepStart: (index) => {
          setLiveStatuses(prev => prev.map((s, i) => i === index ? { ...s, status: 'running' } : s))
          // 🛑 2. อัปเดตสถานะ Tool ในประวัติแชทแบบ Real-time
          setMessages(prev => prev.map(m => 
            m._id === planMsgId 
              ? { ...m, statuses: m.statuses.map((s, i) => i === index ? { ...s, status: 'running' } : s) }
              : m
          ))
        },

        onStepResult: (index, result) => {
          setLiveStatuses(prev => prev.map((s, i) => i === index ? { status: result.ok ? 'ok' : 'fail', summary: result.summary || '' } : s))
          setMessages(prev => prev.map(m => 
            m._id === planMsgId 
              ? { ...m, statuses: m.statuses.map((s, i) => i === index ? { status: result.ok ? 'ok' : 'fail', summary: result.summary || '' } : s) }
              : m
          ))
        },

        onStream: chunk => {
          setThinking(false)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'ai' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + chunk }]
            }
            // 🛑 3. ข้อความ AI ถูกต่อท้ายแบบมี ID ตายตัว
            return [...prev, { _id: 'a-' + Date.now(), role: 'ai', text: chunk, streaming: true }]
          })
        },
      })

      // 🛑 4. พอจบ Turn ก็แค่ดึงธง Streaming ออก ไม่มีการแทรกหรือทำลาย Array แล้ว!
      setMessages(prev => {
        const last = prev[prev.length - 1]
        let base = prev
        let aiMsg = null
        if (last?.role === 'ai' && last?.streaming) {
          aiMsg = { ...last, streaming: false }
          base = prev.slice(0, -1)
        } else if (reply && last?.role !== 'ai') {
          aiMsg = { _id: 'a-' + Date.now(), role: 'ai', text: reply }
        }

        return [...base, ...(aiMsg ? [aiMsg] : [])]
      })

      setLivePlan(null)
      setLiveStatuses([])
      if (lastCommand !== null) lastCommandRef.current = lastCommand

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
    }
  }, [settings, devicesRef, baseTopicRef, setDevices, mqttClient, mqttWaitForStream, handleSaveSettings, apiHistory])

  const clearChat = useCallback(() => {
    stopChat()
    setMessages([])
    setApiHistory([])
    lastCommandRef.current = null
  }, [stopChat])

  return {
    messages, thinking, livePlan, liveStatuses, labelOfStep,
    sendMessage, clearChat, stopChat,
  }
}