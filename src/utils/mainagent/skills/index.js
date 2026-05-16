// Registry รวม skill ทั้งหมดของ main agent
//
// ใช้:
//   SKILLS[step.type]   → skill object
//   buildPlanPrompt(settings) → รวม planPrompt ของ skill ที่ enabled อยู่
//   buildPlanExamples(settings) → รวม example JSON

import { general } from './general.js'
import { deviceNotFound } from './deviceNotFound.js'
import { homeControl } from './homeControl.js'
import { hubControl } from './hubControl.js'
import { realtimeData } from './realtimeData.js'
import { manageSettings } from './manageSettings.js'

export const SKILLS = {
  [general.type]:        general,
  [deviceNotFound.type]: deviceNotFound,
  [homeControl.type]:    homeControl,
  [hubControl.type]:     hubControl,
  [realtimeData.type]:   realtimeData,
  [manageSettings.type]: manageSettings,
}

// คืน skill ที่ user เปิดอยู่ (general/device_not_found เปิดเสมอ — เป็น meta-step)
export function enabledSkills(settings) {
  const enabledNames = new Set(
    (settings?.skills || []).filter(s => s.enabled).map(s => s.name)
  )
  return Object.values(SKILLS).filter(sk =>
    !sk.requiresSkill || enabledNames.has(sk.requiresSkill)
  )
}

export function buildPlanPrompt(settings) {
  return enabledSkills(settings).map(sk => `### ${sk.type}\n${sk.planPrompt}`).join('\n\n')
}

export function buildPlanExamples(settings) {
  return enabledSkills(settings).map(sk => sk.example).filter(Boolean).join(',\n  ')
}
