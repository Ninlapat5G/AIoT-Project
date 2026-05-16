// Mode B — chip ทีละ step โผล่ตามลำดับ execute (ไม่โชว์ plan ทั้งก้อน)
//
// props:
//   label:  string
//   status: 'running' | 'ok' | 'fail'

import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../ui/Icon'

export default function StepChip({ label, status = 'running' }) {
  return (
    <motion.div
      className={`sh-action-chip sh-action-chip--${status}`}
      initial={{ opacity: 0, x: -12, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      <AnimatePresence mode="wait">
        {status === 'running' && (
          <motion.span
            key="run"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          >
            <Icon name="bolt" size={10} />
          </motion.span>
        )}
        {status === 'ok' && (
          <motion.span
            key="ok"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          >
            <Icon name="check" size={10} />
          </motion.span>
        )}
        {status === 'fail' && (
          <motion.span
            key="fail"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
          >
            <Icon name="x" size={10} />
          </motion.span>
        )}
      </AnimatePresence>
      <span>{label}</span>
    </motion.div>
  )
}
