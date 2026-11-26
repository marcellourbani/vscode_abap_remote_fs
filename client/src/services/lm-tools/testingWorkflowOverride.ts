/** Workflow exceptions never disable authorization or executable-resource validation. */
export interface TestingWorkflowOverride {
  skipWorkflowValidation?: boolean
  overrideReason?: string
}

export function workflowBypassNotice(
  input: TestingWorkflowOverride,
  skippedChecks: string
): string | undefined {
  if (input.skipWorkflowValidation !== true) return undefined
  const reason = input.overrideReason?.trim()
  if (!reason) {
    throw new Error(
      "skipWorkflowValidation requires a nonempty overrideReason from the user's request."
    )
  }
  return (
    `WORKFLOW VALIDATION BYPASSED: ${skippedChecks}. Reason: ${reason}\n` +
    "These workflow checks were not verified; results cover only the work actually performed."
  )
}
