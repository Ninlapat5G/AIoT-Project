import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'
import ChatBubble, { TypingBubble } from './chat/ChatBubble'
import ToolPill from './chat/ToolPill'

export default function ChatPage({
  messages, onSend, thinking, executing, onClear, modelName, skillCount, msgCount,
}) {
  const [draft, setDraft] = useState('')
  const [isListening, setIsListening] = useState(false) // 👈 เพิ่ม State สำหรับสถานะไมค์
  const scrollRef = useRef(null)
  const recognitionRef = useRef(null) // 👈 เพิ่ม Ref สำหรับเก็บตัวอัดเสียง

  // 👈 ตั้งค่าระบบฟังเสียง (Speech Recognition) ตอนโหลดคอมโพเนนต์
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // ให้หยุดฟังเองเมื่อเราพูดจบประโยค
      recognition.interimResults = false;
      recognition.lang = 'th-TH'; // 🇹🇭 กำหนดให้ฟังเป็นภาษาไทยตรงนี้เลย!

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        // เอาข้อความที่ฟังได้ มาต่อท้ายข้อความเดิม (ถ้ามี)
        setDraft((prev) => (prev ? prev + ' ' + transcript : transcript));
      };

      recognition.onend = () => {
        setIsListening(false); // ปิดไฟสถานะไมค์ตอนพูดจบ
      };

      recognition.onerror = (event) => {
        console.error("Mic error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, thinking, executing])

  const submit = () => {
    if (draft.trim()) { onSend(draft.trim()); setDraft('') }
  }

  // 👈 ฟังก์ชันสลับเปิด/ปิดไมค์
  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("เบราว์เซอร์นี้ไม่รองรับการพิมพ์ด้วยเสียงน้า ลองเปลี่ยนไปใช้ Chrome ดูนะฮะ 🥺");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  return (
    <div className="sh-chatpage">
      <div className="sh-chat-frame">
        {/* Header */}
        <div className="sh-side-head">
          <div className="sh-side-title">
            <div className="sh-side-dot" />
            <div>
              <div className="sh-side-h1">Assistant</div>
              <div className="sh-side-h2 mono">{modelName || 'typhoon-v2'} · {msgCount} msgs</div>
            </div>
          </div>
          <div className="sh-side-head-right">
            <div className="sh-side-chips mono">
              <span className="sh-chip">{skillCount} tools</span>
              <span className="sh-chip sh-nav-live"><i />live</span>
            </div>
            <button className="sh-icon-btn sh-clear-btn" onClick={onClear} title="Clear chat">
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>

        {/* Message list */}
        <div className="sh-side-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="sh-chat-empty">
              <Icon name="sparkle" size={28} />
              <p>เริ่มต้นบทสนทนาใหม่</p>
              <span className="mono">พิมพ์คำสั่งหรือคำถามด้านล่าง</span>
            </div>
          ) : (
            <>
              <div className="sh-side-timestamp mono">— บทสนทนา —</div>
              {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
            </>
          )}

          <AnimatePresence>
            {executing && (
              <ToolPill
                key="executing"
                name={executing.name}
                args={executing.args}
                executing
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {thinking && !executing && <TypingBubble key="typing" />}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <form
          className="sh-composer"
          onSubmit={e => { e.preventDefault(); submit() }}
        >
          <div className="sh-composer-row">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="สั่งงานบ้าน… เช่น 'เปิดไฟห้องนั่งเล่น' หรือ 'dim bedroom to 80'"
              rows={1}
            />

            {/* 👈 ปุ่มไมโครโฟน */}
            <motion.button
              type="button"
              className="sh-mic-btn"
              onClick={toggleListening}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0 8px',
                color: isListening ? '#ef4444' : 'inherit' // เป็นสีแดงตอนกำลังฟัง
              }}
              title="พิมพ์ด้วยเสียง"
            >
              <Icon name="mic" size={15} />
            </motion.button>

            {/* ปุ่มส่งข้อความเดิม */}
            <motion.button
              type="submit"
              className="sh-send"
              disabled={!draft.trim() || thinking || !!executing}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
            >
              <Icon name="send" size={15} />
            </motion.button>
          </div>
          <div className="sh-composer-hints mono">
            <span>⏎ ส่ง</span>
            <span>⇧⏎ บรรทัดใหม่</span>
            <span className="sh-composer-spacer" />
            <span><Icon name="shield" size={10} /> encrypted</span>
          </div>
        </form>
      </div>
    </div>
  )
}