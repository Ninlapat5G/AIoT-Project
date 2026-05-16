// Mode A — โชว์ plan ทั้งก้อน ติ๊ก ☐ → ⏳ → ✓/✗ ทีละ step
//
// props:
//   plan:     { steps: [{ type, ... }] }
//   statuses: [{ status: 'pending'|'running'|'ok'|'fail', summary }]  per step
//   labelOf:  (step) => string

import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../ui/Icon'

function StatusIcon({ status }) {
  if (status === 'running') {
    return (
      <motion.span
        className="sh-plan-spin"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      >
        <Icon name="bolt" size={11} />
      </motion.span>
    )
  }
  if (status === 'ok') {
    return (
      <motion.span
        key="ok"
        className="sh-plan-ok"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      >
        <Icon name="check" size={11} />
      </motion.span>
    )
  }
  if (status === 'fail') {
    return (
      <motion.span
        key="fail"
        className="sh-plan-fail"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      >
        <Icon name="x" size={11} />
      </motion.span>
    )
  }
  return <span className="sh-plan-pending">☐</span>
}

export default function PlanCard({ plan, statuses, labelOf }) {
  const steps = plan?.steps || []
  if (steps.length === 0) return null

  return (
    <motion.div
      className="sh-plan-card"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <div className="sh-plan-head mono">
        <Icon name="bolt" size={11} />
        <span>แผนการทำงาน</span>
        <span className="sh-plan-count">{steps.length} step</span>
      </div>
      <ul className="sh-plan-list">
        <AnimatePresence initial={false}>
          {steps.map((step, i) => {
            const s = statuses?.[i] || { status: 'pending' }
            return (
              <motion.li
                key={i}
                className={`sh-plan-row sh-plan-row--${s.status}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 28 }}
              >
                <span className="sh-plan-icon">
                  <AnimatePresence mode="wait">
                    <StatusIcon key={s.status} status={s.status} />
                  </AnimatePresence>
                </span>
                <span className="sh-plan-body">
                  <span className="sh-plan-type mono">{step.type}</span>
                  <span className="sh-plan-label">{labelOf(step)}</span>
                  {s.summary && s.status !== 'pending' && s.status !== 'running' && (
                    <span className="sh-plan-result mono">{s.summary}</span>
                  )}
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </motion.div>
  )
}
