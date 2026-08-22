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
  // react-markdown v10 ไม่ส่ง prop `inline` มาให้แล้ว — fenced code block กับ
  // inline code ต่างกันตรงที่ตัวแรกมี <pre> ครอบ ส่วนตัวหลังไม่มี จึงแยกด้วย
  // การ override `pre` แทน (code ที่ไม่ได้อยู่ใน pre = inline โดยธรรมชาติ)
  pre:  ({ children }) => <pre className="sh-md-pre">{children}</pre>,
  code: ({ node, children }) => <code className="sh-md-code">{children}</code>,
}

const AvatarLogo = () => (
  <img src="/syn_icon.jpg" />
)

export default function ChatBubble({ msg, assistantName = 'Assistant', showToolDetails = true, labelOfStep }) {
  // Interim status — evaluator กำลังตัดสินใจ แสดงเป็น bubble เหมือน AI ปกติ
  if (msg.role === 'interim') {
    return (
      <motion.div
        className="sh-msg ai"
        initial={{ opacity: 0, x: -16, y: 4 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, x: -8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <motion.div
          className="sh-msg-avatar"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28, delay: 0.05 }}
        >
          <AvatarLogo />
        </motion.div>
        <div className="sh-msg-bubble">
          <div className="sh-typing">
            <motion.span
              className="sh-typing-label"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            >
              {assistantName} {msg.text}
            </motion.span>
            <div className="sh-typing-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
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
            const s = msg.statuses?.[i] || { status: 'running' }
            return (
              <StepChip
                key={i}
                label={labelOfStep(step)}
                status={s.status === 'ok' || s.status === 'fail' ? s.status : 'running'}
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
          <motion.span
            className="sh-typing-label"
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          >
            กำลังคิด
          </motion.span>
          <div className="sh-typing-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
