// Registry สำหรับ skills ของ onboarding agent
// หมายเหตุ: ไม่มี greet — greet เป็น agent แยก (onboarding/greet.js) รันครั้งเดียว
import { extractName } from './extractName.js'
import { inspectSystem } from './inspectSystem.js'
import { explainSetup } from './explainSetup.js'
import { farewell } from './farewell.js'

export const SKILLS = {
  [extractName.type]:   extractName,
  [inspectSystem.type]: inspectSystem,
  [explainSetup.type]:  explainSetup,
  [farewell.type]:      farewell,
}

export function buildPlanPrompt() {
  return Object.values(SKILLS)
    .map(sk => `### ${sk.type}\n${sk.planPrompt}`)
    .join('\n\n')
}

export function buildPlanExamples() {
  return Object.values(SKILLS).map(sk => sk.example).filter(Boolean).join(',\n  ')
}

// รวม responseGuide ของทุก skill ใน plan — response node เอาไปประกอบเป็น prompt
export function collectResponseGuides(plan) {
  const types = (plan?.steps || []).map(s => s.type)
  return types
    .map(t => SKILLS[t]?.responseGuide)
    .filter(Boolean)
    .join('\n\n')
}
