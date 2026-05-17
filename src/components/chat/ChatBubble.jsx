import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PlanCard from './PlanCard'
import StepChip from './StepChip'

const mdComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="sh-md-link">
      {children}
    </a>
  ),
  code: ({ inline, children }) => inline
    ? <code className="sh-md-code">{children}</code>
    : <pre className="sh-md-pre"><code>{children}</code></pre>,
}

const AvatarLogo = () => (
  <img src="/syn_icon.jpg" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
)

export default function ChatBubble({ msg, assistantName = 'Assistant', showToolDetails = true, labelOfStep }) {
  // Interim status — chip ลอย ๆ ระหว่างรอ synthesizer/router2 ทำงาน
  if (msg.role === 'interim') {
    return (
      <motion.div
        className="sh-interim-chip"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
      >
        <span className="sh-interim-text">{assistantName}{msg.text}</span>
        <span className="sh-interim-dots"><span /><span /><span /></span>
      </motion.div>
    )
  }

  // Plan message — โผล่หลัง turn จบ
  if (msg.role === 'plan') {
    if (showToolDetails) {
      return <PlanCard plan={msg.plan} statuses={msg.statuses} labelOf={labelOfStep} />
    }
    // Mode B: โชว์ chip ทีละ step ตามที่ทำไป
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <AnimatePresence>
          {msg.plan.steps.map((step, i) => {
            const s = msg.statuses?.[i] || { status: 'ok' }
            return (
              <StepChip
                key={i}
                label={labelOfStep(step)}
                status={s.status === 'pending' || s.status === 'running' ? 'ok' : s.status}
              />
            )
          })}
        </AnimatePresence>
      </div>
    )
  }

  const isUser = msg.role === 'user'

  return (
    <motion.div
      className={`sh-msg ${msg.role}`}
      initial={{ opacity: 0, x: isUser ? 16 : -16, y: 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {!isUser && (
        <motion.div
          className="sh-msg-avatar"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 0.05 }}
        >
          <AvatarLogo />
        </motion.div>
      )}
      <div className="sh-msg-bubble">
        {!isUser && <div className="sh-msg-who mono">{assistantName.toUpperCase()}</div>}
        <div className="sh-msg-text">
          {isUser
            ? msg.text
            : <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.text}</ReactMarkdown>
          }
        </div>
      </div>
    </motion.div>
  )
}

export function TypingBubble({ assistantName = 'Assistant' }) {
  return (
    <motion.div
      className="sh-msg ai"
      initial={{ opacity: 0, x: -16, y: 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-msg-avatar">
        <img src="/syn_icon.jpg" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
      </div>
      <div className="sh-msg-bubble">
        <div className="sh-msg-who mono">{assistantName.toUpperCase()}</div>
        <div className="sh-typing">
          <span /><span /><span />
        </div>
      </div>
    </motion.div>
  )
}
