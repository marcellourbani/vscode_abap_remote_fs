const VERIFY_ATTEMPTS = 10
const VERIFY_DELAY_MS = 1000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const normalizeSource = (source: string) =>
  source
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "")

const sameSource = (left: string, right: string) => normalizeSource(left) === normalizeSource(right)

const firstDifference = (expected: string, actual: string) => {
  const expectedLines = normalizeSource(expected).split("\n")
  const actualLines = normalizeSource(actual).split("\n")
  const length = Math.max(expectedLines.length, actualLines.length)
  for (let index = 0; index < length; index++)
    if (expectedLines[index] !== actualLines[index])
      return `First difference at line ${index + 1}: expected "${expectedLines[index] ?? ""}", SAP has "${actualLines[index] ?? ""}".`
  return ""
}

export const RE_READ_ADVICE =
  "Read the current source with abapfs_get_object_source before editing again."

const verificationError = (
  expected: string,
  previous: string,
  actual?: string,
  error?: unknown
) => {
  if (actual === undefined)
    return new Error(
      `SAP accepted the write, but the inactive source could not be read back: ${(error as Error)?.message || error}. ${RE_READ_ADVICE}`
    )
  if (sameSource(actual, previous))
    return new Error(
      `The save did not reach SAP: SAP still has the previous source (the save may have been cancelled, for example in the transport selection). ${RE_READ_ADVICE}`
    )
  return new Error(
    `SAP accepted the write, but the inactive source does not match the requested replacement. ${firstDifference(expected, actual)} ${RE_READ_ADVICE}`
  )
}

export async function verifyInactiveSource(
  read: () => Promise<string>,
  expected: string,
  previous: string
) {
  let actual: string | undefined
  let error: unknown
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    try {
      actual = await read()
      error = undefined
      if (sameSource(actual, expected)) return
    } catch (readError) {
      error = readError
    }
    if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS)
  }
  throw verificationError(expected, previous, error ? undefined : actual, error)
}
