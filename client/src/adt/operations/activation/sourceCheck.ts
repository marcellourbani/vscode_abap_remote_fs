/** Line endings and trailing blanks are not significant in ABAP source */
const normalizeSource = (source: string) =>
  source
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .join("\n")
    .trimEnd()

export const sameSource = (left: string, right: string) =>
  normalizeSource(left) === normalizeSource(right)

export const sourceMismatchSummary = (name: string) =>
  `The source of ${name} in SAP doesn't match your editor, so activating would activate different code. Save the file again and retry.`

export const stillInactiveSummary = (name: string) =>
  `SAP reported a successful activation, but ${name} is still inactive. Activate it from "Load unactivated objects", or check it in SAP GUI.`
