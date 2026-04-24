import { motion } from 'framer-motion'
import Icon from '../ui/Icon'
import ToolPill from './ToolPill'

export default function ChatBubble({ msg }) {
  if (msg.role === 'tool') {
    return <ToolPill name={msg.name} args={msg.args} result={msg.result} round={msg.round} />
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
          <Icon name="sparkle" size={13} />
        </motion.div>
      )}
      <div className="sh-msg-bubble">
        {!isUser && <div className="sh-msg-who mono">ASSISTANT</div>}
        <div className="sh-msg-text">{msg.text}</div>
      </div>
    </motion.div>
  )
}

export function TypingBubble() {
  return (
    <motion.div
      className="sh-msg ai"
      initial={{ opacity: 0, x: -16, y: 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="sh-msg-avatar">
        <Icon name="sparkle" size={13} />
      </div>
      <div className="sh-msg-bubble">
        <div className="sh-msg-who mono">ASSISTANT</div>
        <div className="sh-typing">
          <span /><span /><span />
        </div>
      </div>
    </motion.div>
  )
}
