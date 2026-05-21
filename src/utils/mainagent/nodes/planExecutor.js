import { SKILLS } from '../skills/index.js'

const PARALLEL_TYPES = new Set(['home_control', 'hub_control'])

async function runStep(step, i, state) {
  const { signal, onStepStart, onStepResult } = state
  if (signal?.aborted) {
    const result = { ok: false, summary: '✗ ยกเลิก' }
    onStepResult?.(i, result)
    return result
  }

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
  onStepResult?.(i, result)
  return result
}

export async function planExecutorNode(state) {
  const t0 = Date.now()
  const { plan } = state

  const steps = plan?.steps || []
  console.log(`  [Executor] start — ${steps.length} step(s): ${JSON.stringify(steps.map(s => s.type))}`)

  const canParallel = steps.every(s => PARALLEL_TYPES.has(s.type))

  let results
  if (canParallel && steps.length > 1) {
    console.log('  [Executor] mode: parallel')
    results = await Promise.all(steps.map((step, i) => runStep(step, i, state)))
  } else {
    results = []
    for (let i = 0; i < steps.length; i++) {
      results.push(await runStep(steps[i], i, state))
    }
  }

  const completed  = results.map(r => r.summary || '')
  const failedSteps = results
    .map((r, i) => r.ok ? null : { step: steps[i], summary: r.summary || '' })
    .filter(Boolean)

  // ถ้า hub ถามกลับ → ตั้ง pending_answer ทันที ไม่รอ summarizer อนุมาน
  const hubQuestion = results
    .filter((r, i) => r.ok && steps[i].type === 'hub_control')
    .map(r => r.summary || '')
    .find(s => s.trimEnd().endsWith('?'))

  console.log(`  [Executor] done ${Date.now() - t0}ms`)
  return {
    completed,
    failed_steps: failedSteps,
    has_failed_step: failedSteps.length > 0,
    ...(hubQuestion ? { pending_answer: hubQuestion } : {}),
  }
}
