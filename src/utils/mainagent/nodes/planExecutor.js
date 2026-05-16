// plan_executor — walker เดิน step ทีละอันตามลำดับ
//
// ไม่ตัดสินใจเอง — แค่ส่ง step ต่อให้ skill handler
// ยิง callback onStepStart / onStepResult ให้ UI แสดงผล
// (onPlanReady ถูกยิงจาก agent.js หลัง routerPlanner เสร็จ)

import { SKILLS } from '../skills/index.js'

export async function planExecutorNode(state) {
  const {
    plan, signal,
    onStepStart, onStepResult,
  } = state

  const steps = plan?.steps || []
  const completed = []

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) break

    const step = steps[i]
    const skill = SKILLS[step.type]

    onStepStart?.(i)

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

    console.log(`  [Executor] ${result.ok ? '✓' : '✗'} ${step.type} — ${result.summary?.slice(0, 80)}`)

    completed.push(result.summary || '')
    onStepResult?.(i, result)
  }

  return { completed }
}
