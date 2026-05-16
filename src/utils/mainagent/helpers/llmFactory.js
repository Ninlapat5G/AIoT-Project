import { ChatOpenAI } from '@langchain/openai'
import { DEFAULT_API_KEY } from '../../../config/default_key'

export function makeLLM(settings, { temperature = 0.1, maxTokens, structured } = {}) {
  const apiKey = settings.apiKey || DEFAULT_API_KEY
  let llm = new ChatOpenAI({
    apiKey,
    configuration: { apiKey, baseURL: settings.endpoint, dangerouslyAllowBrowser: true },
    modelName: settings.model,
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
  })
  if (structured) llm = llm.withStructuredOutput(structured)
  return llm
}

export function nowString() {
  return new Date().toLocaleString('th-TH-u-ca-gregory', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', timeZoneName: 'short',
  })
}
