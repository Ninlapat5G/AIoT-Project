import { snapshotText } from '../../kg.js'
import { nowString } from '../helpers/llmFactory.js'
import { summarizeHistory } from '../helpers/historySummarizer.js'

export async function memoryCompressorNode(state) {
  const { messages, settings, signal, deviceList } = state
  const devices = (deviceList?.current ?? deviceList) || []
  const kgText = snapshotText({ devices, settings, now: nowString() })

  console.log(`  [MemoryCompressor] Running final single-turn summarization...`)
  
  const summaryResult = await summarizeHistory(messages, settings, signal, kgText)

  // เตรียมประวัติแชทที่ถูก Optimize เพื่อส่งกลับออกไปเก็บใน State ภายนอกรอบหน้า
  return {
    chat_summary: summaryResult.chat_summary,
    lastCommand: summaryResult.last_command,
    optimizedHistory: [
      { role: 'user', content: `[ประวัติการสนทนาก่อนหน้า]\n${summaryResult.chat_summary}` }
    ]
  }
}