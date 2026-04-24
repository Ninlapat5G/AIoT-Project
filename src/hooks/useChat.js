import { useState, useCallback, useRef } from 'react'
import { runAgent } from '../utils/agent'

export function useChat({ settings, devicesRef, executeTool }) {
  const [messages, setMessages] = useState([])
  const [apiHistory, setApiHistory] = useState([])
  const [thinking, setThinking] = useState(false)
  const [executing, setExecuting] = useState(null)

  const abortControllerRef = useRef(null)

  const stopChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const sendMessage = useCallback(async text => {
    if (!settings.apiKey) {
      setMessages(prev => [
        ...prev,
        { role: 'user', text },
        { role: 'ai', text: '⚠️ กรุณาตั้งค่า API Key ในหน้า Settings ก่อนใช้งาน' },
      ])
      return
    }

    setMessages(prev => [...prev, { role: 'user', text }])
    setThinking(true)
    setExecuting(null)

    abortControllerRef.current = new AbortController()

    try {
      const { reply } = await runAgent({
        text,
        settings,
        deviceList: devicesRef.current,
        apiHistory,
        executeTool,
        signal: abortControllerRef.current.signal,
        onToolCall: (name, args, round) => {
          setThinking(false)
          setExecuting({ name, args, round })
        },
        onToolResult: (name, args, result, round) => {
          setExecuting(null)
          setThinking(true)
          setMessages(prev => [...prev, { role: 'tool', name, args, result, round }])
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

      setApiHistory(prev => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: reply },
      ].slice(-10))
    } catch (err) {
      if (err.name === 'AbortError') {
        // ✨ มักเพิ่มข้อความหยุดการทำงานให้ตรงนี้เลยฮะ
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'ai' && last?.streaming) {
            return [...prev.slice(0, -1), { role: 'ai', text: last.text + '\n\n*— 🛑 หยุดการสร้างข้อความ —*' }]
          } else if (last?.role === 'user' || executing) {
            // กรณีหยุดตอนที่มันยังคิดอยู่ หรือกำลังรัน Tool
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
      setExecuting(null)
    }
  }, [settings, devicesRef, apiHistory, executeTool])

  const clearChat = useCallback(() => {
    stopChat()
    setMessages([])
    setApiHistory([])
  }, [stopChat])

  return { messages, thinking, executing, sendMessage, clearChat, stopChat }
}