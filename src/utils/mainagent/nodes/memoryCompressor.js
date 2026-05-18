import { snapshotText } from '../../kg.js'
import { nowString } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

function buildPendingContext(state) {
  const parts = []
  if (state.needs_clarify && state.clarify_question) {
    parts.push(`- assistant ถาม user ว่า: "${state.clarify_question}"`)
  }
  if (state.failed_steps?.length) {
    for (const f of state.failed_steps) {
      const dev = f.step?.device ? ` (${f.step.device})` : ''
      parts.push(`- step ล้มเหลว: ${f.step?.type || 'step'}${dev} — ${f.summary}`)
    }
  }
  return parts.join('\n')
}

export async function memoryCompressorNode(state) {
  const { messages, settings, signal, deviceList } = state
  const devices = (deviceList?.current ?? deviceList) || []
  const kgText = snapshotText({ devices, settings, now: nowString() })
  const pendingContext = buildPendingContext(state)

  console.log(`  [MemoryCompressor] Running final single-turn summarization...`)

  const summaryResult = await summarizeHistory(messages, settings, signal, kgText, pendingContext, state.chat_summary || '')

  return {
    chat_summary:  summaryResult.chat_summary,
    lastCommand:   summaryResult.last_command,
    pending_answer: summaryResult.pending_answer,
  }
}
