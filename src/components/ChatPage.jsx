import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'
import ChatBubble, { TypingBubble } from './chat/ChatBubble'
import ToolPill from './chat/ToolPill'

export default function ChatPage({
  messages, onSend, onStop, thinking, executing, onClear, modelName, skillCount, msgCount,
  draft, onDraftChange: setDraft, assistantName = 'Assistant', showToolDetails = true,
}) {
  const [isListening, setIsListening] = useState(false)
  const scrollRef = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'th-TH';

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript.trim()) {
          onSend(transcript.trim())
          setDraft('')
        }
      };

      recognition.onend = () => {
        setIsListening(false);
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
            <div>
              <div className="sh-side-h1">{assistantName}</div>
              <div className="sh-side-h2 mono">powered by SynaptaOS · {modelName || 'typhoon-v2'}</div>
            </div>
          </div>
          <div className="sh-side-head-right">
            <div className="sh-side-chips mono">
              <span className="sh-chip">{skillCount} tools</span>
              <span className="sh-chip sh-nav-live"><i />live</span>
            </div>
            {onClear && (
              <button className="sh-icon-btn sh-clear-btn" onClick={onClear} title="Clear chat">
                <Icon name="trash" size={15} />
              </button>
            )}
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
              {messages.map((m, i) => <ChatBubble key={i} msg={m} assistantName={assistantName} showToolDetails={showToolDetails} />)}
            </>
          )}

          {/* Tool executing display — full pills or compact chip depending on setting */}
          <AnimatePresence>
            {!showToolDetails && executing.length > 0 ? (
              <motion.div
                key="executing-chip"
                className="sh-action-chip sh-action-chip--executing"
                initial={{ opacity: 0, scale: 0.9, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <motion.span
                  animate={{ opacity: [1, 0.35, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                >
                  <Icon name="bolt" size={10} />
                </motion.span>
                <span>กำลังดำเนินการ</span>
                <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginLeft: 2 }}>
                  {[0, 1, 2].map(i => (
                    <motion.span
                      key={i}
                      style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: 'currentColor', display: 'inline-block' }}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.15, ease: 'easeInOut' }}
                    />
                  ))}
                </span>
              </motion.div>
            ) : (
              executing.map(e => (
                <ToolPill
                  key={`${e.name}-r${e.round}`}
                  name={e.name}
                  args={e.args}
                  round={e.round}
                  executing
                />
              ))
            )}
          </AnimatePresence>

          <AnimatePresence>
            {thinking && executing.length === 0 && <TypingBubble key="typing" assistantName={assistantName} />}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <form
          className="sh-composer"
          onSubmit={e => { e.preventDefault(); submit() }}
        >
          <div className="sh-composer-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={isListening ? "กำลังตั้งใจฟังอยู่ฮะ... 🎙️" : "สั่งงานบ้าน… เช่น 'เปิดไฟห้องนั่งเล่น'"}
              rows={1}
              style={{ flex: 1 }}
            />

            {/* ปุ่มไมโครโฟน */}
            <motion.button
              type="button"
              className="sh-send"
              onClick={toggleListening}
              animate={
                isListening
                  ? { scale: [1, 1.15, 1], backgroundColor: ['#ef4444', '#dc2626', '#ef4444'], color: '#ffffff' }
                  : { scale: 1 }
              }
              transition={{ repeat: isListening ? Infinity : 0, duration: 1.2 }}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              style={{
                backgroundColor: isListening ? '#ef4444' : 'transparent',
                color: isListening ? '#ffffff' : 'inherit',
                border: isListening ? 'none' : ''
              }}
              title="พิมพ์ด้วยเสียง"
            >
              <Icon name="mic" size={15} />
            </motion.button>

            {/* ปุ่มส่งข้อความ หรือ หยุด */}
            {(thinking || executing.length > 0) ? (
              <motion.button
                type="button"
                className="sh-send"
                onClick={onStop}
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                style={{ backgroundColor: '#ef4444', color: '#ffffff', border: 'none' }}
                title="หยุดสร้างข้อความ"
              >
                <Icon name="x" size={15} />
              </motion.button>
            ) : (
              <motion.button
                type="submit"
                className="sh-send"
                disabled={!draft.trim()}
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
              >
                <Icon name="send" size={15} />
              </motion.button>
            )}
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