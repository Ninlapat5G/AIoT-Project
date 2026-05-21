import { knowledge_data } from '../../kg.js'
import { nowString } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

function buildPendingContext(state) {
  const parts = []
  if (state.failed_steps?.length) {
    for (const f of state.failed_steps) {
      const dev = f.step?.device ? ` (${f.step.device})` : ''
      parts.push(`- step ล้มเหลว: ${f.step?.type || 'step'}${dev} — ${f.summary}`)
    }
  }
  return parts.join('\n')
}

export async function memoryCompressorNode(state) {
  const t0 = Date.now()
  console.log('  [MemoryCompressor] start')
  const { messages, settings, signal, deviceList } = state
  const devices = (deviceList?.current ?? deviceList) || []
  const kgText = knowledge_data({ devices, settings, now: nowString() })
  const pendingContext = buildPendingContext(state)

  console.log('  [MemoryCompressor] summarizing...')

  const summaryResult = await summarizeHistory(messages, settings, signal, kgText, pendingContext, state.chat_summary || '', state.pending_answer || '')

  console.log(`  [MemoryCompressor] done ${Date.now() - t0}ms`)
  return {
    chat_summary:  summaryResult.chat_summary,
    lastCommand:   summaryResult.last_command,
    pending_answer: summaryResult.pending_answer,
  }
}
