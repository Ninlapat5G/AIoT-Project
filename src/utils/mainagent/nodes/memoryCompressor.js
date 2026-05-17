import { snapshotText } from '../../kg.js'
import { nowString } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

function buildWaitRetry(failedSteps) {
  if (!failedSteps?.length) return ''
  const lines = failedSteps.map(f => {
    const dev = f.step?.device ? ` (${f.step.device})` : ''
    return `- ${f.step?.type || 'step'}${dev}: ${f.summary} (พยายาม ${f.attempts} ครั้ง)`
  }).join('\n')
  return `งานที่ทำไม่สำเร็จใน turn ล่าสุด:\n${lines}`
}

export async function memoryCompressorNode(state) {
  const { messages, settings, signal, deviceList } = state
  const devices = (deviceList?.current ?? deviceList) || []
  const kgText = snapshotText({ devices, settings, now: nowString() })

  console.log(`  [MemoryCompressor] Running final single-turn summarization...`)

  const summaryResult = await summarizeHistory(messages, settings, signal, kgText)

  // carry-over: ทุก turn คำนวณใหม่ ทับของเก่า → reset เมื่อทำเสร็จ/ไม่ใช่ clarify
  const wait_retry = buildWaitRetry(state.failed_steps)
  const pending_clarify = state.needs_clarify ? (state.clarify_question || '') : ''

  return {
    chat_summary: summaryResult.chat_summary,
    lastCommand: summaryResult.last_command,
    optimizedHistory: [
      { role: 'user', content: `[ประวัติการสนทนาก่อนหน้า]\n${summaryResult.chat_summary}` }
    ],
    wait_retry,
    pending_clarify,
  }
}
