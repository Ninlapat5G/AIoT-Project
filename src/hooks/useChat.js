import { useState, useCallback, useRef } from 'react'
import { runAgent } from '../utils/agent'

export function useChat({ settings, devicesRef, executeTool }) {
  const [messages, setMessages]     = useState([])
  const [apiHistory, setApiHistory] = useState([])
  const [thinking, setThinking]     = useState(false)
  const [executing, setExecuting]   = useState([])  // array — parallel tools run simultaneously

  const abortControllerRef = useRef(null)
  const prevToolResultsRef = useRef(null)

  const stopChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setThinking(false)
    setExecuting([])
  }, [])

  const sendMessage = useCallback(async text => {
    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)
    setExecuting([])

    abortControllerRef.current = new AbortController()
    const toolsThisTurn = []

    try {
      const { reply } = await runAgent({
        text,
        settings,
        deviceList: devicesRef.current,
        apiHistory,
        executeTool,
        prevToolResults: prevToolResultsRef.current,
        signal: abortControllerRef.current.signal,

        onToolCall: (name, args, round) => {
          setThinking(false)
          setExecuting(prev => [...prev, { name, args, round }])
          // Remove ALL streaming AI messages — pre-tool reasoning text must not appear
          // as completed responses (fires for every tool call, safe to run multiple times)
          setMessages(prev => prev.filter(m => !(m.role === 'ai' && m.streaming)))
        },

        onToolResult: (name, args, result, round) => {
          toolsThisTurn.push({ name, result })
          // เมื่อ showToolDetails === false ไม่แสดง pill ทีละตัว (จะมี round-summary chip แทน)
          if (settings.showToolDetails !== false) {
            setMessages(prev => [...prev, { role: 'tool', name, args, result, round }])
          }
          setExecuting(prev => {
            const next = prev.filter(e => !(e.name === name && e.round === round))
            if (next.length === 0) setThinking(true)
            return next
          })
        },

        onRoundSummary: (summary, round) => {
          setMessages(prev => {
            const clean = prev.filter(m => !(m.role === 'ai' && m.streaming))
            return [...clean, { role: 'round-summary', summary, round }]
          })
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

      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.role === 'ai' && last?.streaming) {
          return [...prev.slice(0, -1), { role: 'ai', text: last.text }]
        }
        if (reply && last?.role !== 'ai') {
          return [...prev, { role: 'ai', text: reply }]
        }
        return prev
      })

      prevToolResultsRef.current = toolsThisTurn.length > 0
        ? toolsThisTurn.map(t => `${t.name}→${JSON.stringify(t.result).slice(0, 150)}`).join('; ')
        : null

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
          } else if (last?.role === 'user' || executing.length > 0) {
            return [...prev, { role: 'ai', text: '*— 🛑 ยกเลิกการประมวลผล —*' }]
          }
          return prev
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
      setExecuting([])
    }
  }, [settings, devicesRef, apiHistory, executeTool])

  const clearChat = useCallback(() => {
    stopChat()
    setMessages([])
    setApiHistory([])
  }, [stopChat])

  return { messages, thinking, executing, sendMessage, clearChat, stopChat }
}
