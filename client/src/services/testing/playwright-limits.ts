export const DEFAULT_MAX_FAILURES = 3
export const MAX_MAX_FAILURES = 10
export const DEFAULT_MAX_TASKS = 3
export const MAX_MAX_TASKS = 5

export function normalizeMaxFailures(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_FAILURES
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("playwright_test maxFailures must be a positive integer.")
  }
  return Math.min(limit, MAX_MAX_FAILURES)
}

export function normalizeMaxTasks(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_TASKS
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("playwright_test maxTasks must be a positive integer.")
  }
  return Math.min(limit, MAX_MAX_TASKS)
}

export function normalizeTcIds(value: string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.length) {
    throw new Error("playwright_test tcIds must be a non-empty array when supplied.")
  }
  const ids = value.map(id => (typeof id === "string" ? id.trim() : ""))
  const invalid = ids.filter(id => !/^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(id))
  if (invalid.length) {
    throw new Error(`playwright_test tcIds contains invalid test case IDs: ${invalid.join(", ")}`)
  }
  return [...new Set(ids)]
}
