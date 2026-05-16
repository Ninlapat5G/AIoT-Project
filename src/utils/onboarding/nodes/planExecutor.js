// plan_executor สำหรับ onboarding
// เดิน step ทีละอัน — รับ stateUpdate กลับมาเพื่อแก้ userName/stage

import { SKILLS } from '../skills/index.js'

export async function planExecutorNode(state) {
  const { plan, signal, onStepStart, onStepResult } = state
  const steps = plan?.steps || []
  const completed = []
  let stateMerge = {}

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) break
    const step = steps[i]
    const skill = SKILLS[step.type]

    onStepStart?.(i)

    let result
    if (!skill) {
      result = { ok: false, summary: `✗ ไม่รู้จัก step: ${step.type}` }
    } else {
      try {
        result = await skill.execute(step, state)
      } catch (err) {
        result = { ok: false, summary: `✗ ${step.type}: ${err.message}` }
      }
    }

    console.log(`  [Onboarding Executor] ${result.ok ? '✓' : '✗'} ${step.type} — ${result.summary?.slice(0, 80)}`)

    completed.push(result.summary || '')
    if (result.stateUpdate) stateMerge = { ...stateMerge, ...result.stateUpdate }

    onStepResult?.(i, result)
  }

  return { completed, ...stateMerge }
}
