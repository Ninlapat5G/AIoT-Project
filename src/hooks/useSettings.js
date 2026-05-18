import { useState, useCallback, useRef, useEffect } from 'react'
import { DEFAULT_SETTINGS } from '../data'
import { saveSettings, loadSettings } from '../utils/storage'
import { detectAssistantName } from '../utils/mainagent/agent'
import { extractNameFromText } from '../utils/onboarding/onboarding'

const LAST_DETECTED_PROMPT_KEY = 'sh_last_detected_prompt'
const LAST_DETECTED_BIO_KEY    = 'sh_last_detected_bio'

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings()
    if (!saved) return DEFAULT_SETTINGS

    // Merge skills: only keep skills that exist in DEFAULT_SETTINGS (filters out removed skills)
    const defaultByName = Object.fromEntries(DEFAULT_SETTINGS.skills.map(s => [s.name, s]))
    const savedNames = new Set((saved.skills || []).map(s => s.name))
    const mergedSkills = [
      ...(saved.skills || [])
        .filter(s => defaultByName[s.name])
        .map(s => ({ ...defaultByName[s.name], enabled: s.enabled })),
      ...DEFAULT_SETTINGS.skills.filter(s => !savedNames.has(s.name)),
    ]
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      mqtt: { ...DEFAULT_SETTINGS.mqtt, ...saved.mqtt },
      skills: mergedSkills,
    }
  })

  // Keep a ref in sync so MQTT/tool utilities can read the latest baseTopic
  // without needing it as a dependency in their own useCallbacks.
  const baseTopicRef = useRef(settings.mqtt.baseTopic)
  useEffect(() => {
    baseTopicRef.current = settings.mqtt.baseTopic
  }, [settings.mqtt.baseTopic])

  // Keep a ref to the full settings so the debounced detection callback
  // always reads the latest apiKey/endpoint/model without extra deps.
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Auto-detect assistant name whenever systemPrompt changes.
  // Compares against the last prompt that was successfully processed
  // (persisted in localStorage) to skip on page reload with no changes.
  // If the API call fails the prompt is NOT marked as processed,
  // so the next prompt change will retry.
  useEffect(() => {
    const lastDetected = localStorage.getItem(LAST_DETECTED_PROMPT_KEY) || ''
    if (settings.systemPrompt === lastDetected) return

    const timer = setTimeout(async () => {
      const s = settingsRef.current
      if (!s.apiKey || !s.endpoint) return

      const currentPrompt = s.systemPrompt
      // Double-check inside timeout in case another keystroke fired during debounce
      if (currentPrompt === (localStorage.getItem(LAST_DETECTED_PROMPT_KEY) || '')) return

      try {
        const name = await detectAssistantName({ settings: s, systemPrompt: currentPrompt })
        // Mark this prompt as processed regardless of whether a name was found
        localStorage.setItem(LAST_DETECTED_PROMPT_KEY, currentPrompt)
        if (name) {
          setSettings(prev => {
            const next = { ...prev, profile: { ...prev.profile, assistantName: name } }
            saveSettings(next)
            return next
          })
        }
      } catch {
        // API failed → keep current name, don't mark as processed (will retry on next change)
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [settings.systemPrompt])

  // Extract display name from userBio; skips only when bio matches cache AND name is already set.
  useEffect(() => {
    const bio = settings.profile?.userBio
    if (!bio) return
    const lastBio = localStorage.getItem(LAST_DETECTED_BIO_KEY) || ''
    if (bio === lastBio && !!settings.profile?.displayName) return

    const timer = setTimeout(async () => {
      const s = settingsRef.current
      const currentBio = s.profile?.userBio
      const alreadyDone = currentBio === (localStorage.getItem(LAST_DETECTED_BIO_KEY) || '')
      if (alreadyDone && !!s.profile?.displayName) return

      try {
        const { name, initials } = await extractNameFromText(currentBio, s)
        if (!name) return
        localStorage.setItem(LAST_DETECTED_BIO_KEY, currentBio)
        setSettings(prev => {
          if (prev.profile?.displayName === name && prev.profile?.displayInitials === initials) return prev
          const next = { ...prev, profile: { ...prev.profile, displayName: name, displayInitials: initials } }
          saveSettings(next)
          return next
        })
      } catch { /* keep current values on failure, don't mark as processed */ }
    }, 500)

    return () => clearTimeout(timer)
  }, [settings.profile?.userBio, settings.profile?.displayName]) // eslint-disable-line

  const handleSaveSettings = useCallback(s => {
    setSettings(s)
    saveSettings(s)
  }, [])

  return { settings, handleSaveSettings, baseTopicRef }
}
