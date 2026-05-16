// router_planner สำหรับ onboarding — deterministic stage machine
//
// หมายเหตุ: greet ทำโดย agent แยก (onboarding/greet.js) — onboarding agent
// จะเริ่มทำงานหลังจาก greet เสร็จและมี user reply เข้ามาแล้ว
//
//   stage="farewell"          → [farewell]
//   stage="setup"             → [inspect_system, explain_setup]
//   stage="intro" + ไม่มีชื่อ  → [extract_name]
//   stage="intro" + มีชื่อแล้ว → [explain_setup]

export async function routerPlannerNode(state) {
  const { stage, userName } = state

  let steps
  if (stage === 'farewell') {
    steps = [{ type: 'farewell' }]
  } else if (stage === 'setup') {
    steps = [{ type: 'inspect_system' }, { type: 'explain_setup' }]
  } else if (!userName) {
    steps = [{ type: 'extract_name' }]
  } else {
    steps = [{ type: 'explain_setup' }]
  }

  console.log(`  [Onboarding Router] plan → ${JSON.stringify(steps.map(s => s.type))}`)
  return { plan: { steps } }
}
