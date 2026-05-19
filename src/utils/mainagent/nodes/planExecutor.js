import { SKILLS } from '../skills/index.js'

export async function planExecutorNode(state) {
  const t0 = Date.now()
  const { plan, signal, onStepStart, onStepResult } = state

  const steps = plan?.steps || []
  console.log(`  [Executor] start — ${steps.length} step(s): ${JSON.stringify(steps.map(s => s.type))}`)
  const completed = []
  const failedSteps = []

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) break

    const step = steps[i]
    const skill = SKILLS[step.type]

    onStepStart?.(i)

    const tStep = Date.now()
    let result
    if (!skill) {
      result = { ok: false, summary: `✗ ไม่รู้จัก step type: ${step.type}` }
    } else {
      try {
        result = await skill.execute(step, state)
      } catch (err) {
        result = { ok: false, summary: `✗ ${step.type}: ${err.message}` }
      }
    }

    console.log(`  [Executor] ${result.ok ? '✓' : '✗'} ${step.type} — ${result.summary?.slice(0, 80)} (${Date.now() - tStep}ms)`)

    completed.push(result.summary || '')
    if (!result.ok) failedSteps.push({ step, summary: result.summary || '' })
    onStepResult?.(i, result)
  }

  console.log(`  [Executor] done ${Date.now() - t0}ms`)
  return {
    completed,
    failed_steps: failedSteps,
    has_failed_step: failedSteps.length > 0,
  }
}
