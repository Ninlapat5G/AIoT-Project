// plan_executor — walker เดิน step ทีละอันตามลำดับ
//
// ไม่ตัดสินใจเอง — แค่ส่ง step ต่อให้ skill handler
// retry สูงสุด 3 ครั้งต่อ step ที่ fail (ที่สำเร็จไม่รันซ้ำ)
// ยิง callback onStepStart / onStepResult ให้ UI แสดงผล

import { SKILLS } from '../skills/index.js'

const MAX_ATTEMPTS = 3

export async function planExecutorNode(state) {
  const {
    plan, signal,
    onStepStart, onStepResult,
  } = state

  const steps = plan?.steps || []
  const completed = []
  const failedSteps = []

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) break

    const step = steps[i]
    const skill = SKILLS[step.type]

    onStepStart?.(i)

    let result
    let attempt = 0
    while (attempt < MAX_ATTEMPTS) {
      attempt++
      if (!skill) {
        result = { ok: false, summary: `✗ ไม่รู้จัก step type: ${step.type}` }
        break
      }
      try {
        result = await skill.execute(step, state)
      } catch (err) {
        result = { ok: false, summary: `✗ ${step.type}: ${err.message}` }
      }
      if (result.ok) break
      if (signal?.aborted) break
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`  [Executor] retry ${attempt}/${MAX_ATTEMPTS} on ${step.type}`)
      }
    }

    console.log(`  [Executor] ${result.ok ? '✓' : '✗'} ${step.type} (attempts=${attempt}) — ${result.summary?.slice(0, 80)}`)

    completed.push(result.summary || '')
    if (!result.ok) {
      failedSteps.push({ step, summary: result.summary || '', attempts: attempt })
    }
    onStepResult?.(i, result)
  }

  return {
    completed,
    failed_steps: failedSteps,
    has_failed_step: failedSteps.length > 0,
  }
}
