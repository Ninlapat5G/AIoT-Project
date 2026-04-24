import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../ui/Icon'

export default function ToolPill({ name, args, result, round, executing }) {
  return (
    <motion.div
      className={`sh-tool${executing ? ' border-accent/60' : ''}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        boxShadow: executing
          ? '0 0 20px oklch(0.72 0.15 175 / 0.2)'
          : '0 0 0px transparent',
      }}
      transition={{ duration: 0.2 }}
    >
      {/* animated left bar while executing */}
      {executing && (
        <motion.span
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r"
          style={{ background: 'var(--accent)' }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}

      <div className="sh-tool-head">
        <span className="sh-tool-badge mono">
          <Icon name="bolt" size={10} />
          {executing ? 'EXECUTING' : 'TOOL CALL'}{round ? ` · R${round}` : ''}
        </span>
        <span className="sh-tool-name mono">{name}</span>
        <span className="sh-tool-spark">
          <motion.span
            className="absolute top-[-1px] left-0 w-10 h-[3px] rounded"
            style={{
              background: 'var(--accent)',
              boxShadow: '0 0 8px var(--accent)',
              filter: 'blur(1px)',
            }}
            animate={{ x: ['-40px', '200%'] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          />
        </span>
      </div>

      <pre className="sh-tool-args">{JSON.stringify(args, null, 2)}</pre>

      <AnimatePresence>
        {result !== undefined && (
          <motion.div
            className="sh-tool-result"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.25 }}
          >
            <span className="sh-tool-result-label mono">↳ RESULT</span>
            <pre className="sh-tool-args mt-1">{JSON.stringify(result, null, 2)}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
