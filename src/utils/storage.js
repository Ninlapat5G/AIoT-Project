const KEYS = {
  SETTINGS:   'sh_settings',
  DEVICES:    'sh_devices',
  AREAS:      'sh_areas',
  ONBOARDING: 'sh_onboarding',
  TWEAKS:     'sh_tweaks',
}

const ls = {
  get: key => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null } catch { return null }
  },
  set: (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  },
  del: key => {
    try { localStorage.removeItem(key) } catch {}
  },
}

export const saveSettings = obj => ls.set(KEYS.SETTINGS, obj)
export const loadSettings = ()  => ls.get(KEYS.SETTINGS)

export const saveDevices = arr => ls.set(KEYS.DEVICES, arr)
export const loadDevices = ()  => ls.get(KEYS.DEVICES)

export const saveRemovedTopics = arr => ls.set('sh_removed_topics', arr)
export const loadRemovedTopics = ()  => ls.get('sh_removed_topics') ?? []

export const saveAreas = arr => ls.set(KEYS.AREAS, arr)
export const loadAreas = ()  => ls.get(KEYS.AREAS)

export const saveOnboarding = obj => ls.set(KEYS.ONBOARDING, obj)
export const loadOnboarding = ()  => ls.get(KEYS.ONBOARDING)

export const saveTweaks = obj => ls.set(KEYS.TWEAKS, obj)
export const loadTweaks = ()  => ls.get(KEYS.TWEAKS)

export const clearAll = () => Object.values(KEYS).forEach(k => ls.del(k))
