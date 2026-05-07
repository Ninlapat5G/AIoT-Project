import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import ToolPill from './ToolPill'
import Icon from '../ui/Icon'

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

export default function ChatBubble({ msg, assistantName = 'Assistant' }) {
  if (msg.role === 'round-summary') {
    return (
      <motion.div
        className="sh-action-chip"
        initial={{ opacity: 0, scale: 0.82, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 450, damping: 26 }}
      >
        <motion.span
          initial={{ rotate: -25, scale: 1.4 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.08 }}
        >
          <Icon name="bolt" size={10} />
        </motion.span>
        <span>{msg.summary}</span>
      </motion.div>
    )
  }

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
          <AvatarLogo />
        </motion.div>
      )}
      <div className="sh-msg-bubble">
        {!isUser && <div className="sh-msg-who mono">{assistantName.toUpperCase()}</div>}
        <div className="sh-msg-text">
          {isUser
            ? msg.text
            : <ReactMarkdown components={mdComponents}>{msg.text}</ReactMarkdown>
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
