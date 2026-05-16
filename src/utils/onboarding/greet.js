// Greet Agent — แยกออกมาจาก onboarding agent
//
// หน้าที่: ทักทาย user ครั้งแรกเท่านั้น แนะนำตัวเอง + ถามชื่อ
// ไม่มี graph ไม่มี skill — เป็น LLM call เดี่ยวๆ
// run ครั้งเดียวตอน user เข้ามาในหน้า chat ครั้งแรก
// หลังจากนั้นการสนทนาต่อจะเป็นของ onboarding agent

import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { DEFAULT_API_KEY } from '../../config/default_key'

const GREET_PROMPT = `คุณคือ "น้องซิน" (Syn) — AI ผู้ช่วยประจำบ้านอัจฉริยะของระบบ SynaptaOS
เพศ: หญิง | บุคลิก: ร่าเริง ขี้เล่น เป็นกันเองเหมือนเพื่อนสนิทหรือน้องสาว ใช้อีโมจิน่ารักๆ พองาม
รูปแบบการตอบ: ใช้ภาษาไทยแบบลำลอง เป็นธรรมชาติ คุยเหมือนพิมพ์แชท ไม่เป็นทางการ

[เป้าหมายของคุณในรอบนี้: First Impression!]
ทักทายต้อนรับผู้ใช้งานที่เพิ่งเข้ามาเปิดระบบ SynaptaOS เป็นครั้งแรก
1. แนะนำตัวสั้นๆ แบบสดใสและอบอุ่น
2. ถามชื่อเล่นหรือชื่อที่ผู้ใช้เจ้านายอยากให้ซินเรียก เพื่อที่เราจะได้สนิทกันไวๆ!
(ข้อความไม่ต้องยาว เอาแค่ 2-3 ประโยคก็พอ ให้ดูเป็นมิตรที่สุด)`

export async function runGreet({ settings, signal, onStream }) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  const llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature: 0.7,
  })

  let reply = ''
  const stream = await llm.stream(
    [new SystemMessage(GREET_PROMPT), new HumanMessage('[เริ่มต้นบทสนทนา]')],
    { signal }
  )
  for await (const chunk of stream) {
    if (chunk.content) {
      onStream?.(chunk.content)
      reply += chunk.content
    }
  }

  return { reply }
}
