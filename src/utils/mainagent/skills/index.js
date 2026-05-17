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

function enabledSkills(settings) {
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
