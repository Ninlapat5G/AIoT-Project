import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './ui/Icon'
import ChatBubble, { TypingBubble } from './chat/ChatBubble'
import PlanCard from './chat/PlanCard'
import StepChip from './chat/StepChip'

export default function ChatPage({
  messages, onSend, onStop, thinking,
  livePlan, liveStatuses, labelOfStep,
  onClear, modelName, skillCount, msgCount,
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

      recognition.onend = () => { setIsListening(false); };
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
  }, [messages, thinking, livePlan, liveStatuses])

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

  const hasLivePlan = livePlan?.steps?.length > 0;

  // 🛑 1. หาตำแหน่งของข้อความ User ล่าสุด เพื่อเอาไว้ใช้ "ปักหมุด" Tool Pill
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  // 🛑 2. สร้าง Array สำหรับ Render แบบเส้นตรง
  const chatElements = [];
  let uCount = 0, aCount = 0;

  messages.forEach((m, i) => {
    // ให้ Key เสถียร ไม่พึ่งพา index แบบเพียวๆ
    const stableKey = m.role === 'user' ? `u-${++uCount}` : `a-${++aCount}`;

    // วาดกล่องข้อความ
    chatElements.push(
      <ChatBubble
        key={stableKey}
        msg={m}
        assistantName={assistantName}
        showToolDetails={showToolDetails}
        labelOfStep={labelOfStep}
      />
    );

    // 🛑 3. THE ANCHOR POINT: ถ้าข้อความนี้คือ User Message ล่าสุด และมี Tool รันอยู่...
    // ให้แทรก Tool Pill ต่อท้ายตรงนี้เลยทันที! (จะไม่มีการ Unmount อีกต่อไป)
    if (i === lastUserIndex && hasLivePlan) {
      chatElements.push(
        <motion.div
          key="live-plan-anchor"
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 8 }}
        >
          {showToolDetails ? (
            <PlanCard plan={livePlan} statuses={liveStatuses} labelOf={labelOfStep} />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {livePlan.steps.map((step, idx) => {
                const s = liveStatuses[idx]
                if (!s || s.status === 'pending') return null
                return <StepChip key={idx} label={labelOfStep(step)} status={s.status} />
              })}
            </div>
          )}
        </motion.div>
      );
    }
  });

  // กันเหนียว กรณีไม่มีแชทเลย แต่ดันมี Plan วิ่งอยู่ (Edge Case)
  if (messages.length === 0 && hasLivePlan) {
    chatElements.push(
      <motion.div
        key="live-plan-anchor-fallback"
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ marginBottom: 8 }}
      >
        <PlanCard plan={livePlan} statuses={liveStatuses} labelOf={labelOfStep} />
      </motion.div>
    );
  }

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
              {/* แปะก้อนแชทที่ถูกจัดเรียงเสร็จสมบูรณ์ลงไป */}
              {chatElements}
            </>
          )}

          <AnimatePresence>
            {thinking && !hasLivePlan && (lastUserIndex === messages.length - 1) && (
              <TypingBubble key="typing" assistantName={assistantName} />
            )}
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

            {(thinking || hasLivePlan) ? (
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