/**
 * Format — small, pure, deterministic helpers that remove hand-arithmetic from the
 * AI when it prepares test data or builds fixtures. Nothing here talks to Playwright
 * or SAP; every function is a plain string/date transform, fully generic (no
 * business-domain names), safe to unit-test on its own.
 */

/**
 * Left-zero-pad a numeric-string ID the way ABAP's CONVERSION_EXIT_ALPHA_INPUT does
 * for internal-format keys (material, order, article, vendor, ...). Generic on
 * purpose — works for any ABAP key field, not just one business object.
 *
 * Example: padNumericId("11911") -> "000000000000011911" (18 chars, ALPHA default)
 * Example: padNumericId("1000", 4) -> "1000" (already at length, e.g. plant/site)
 */
export function padNumericId(value: string, length = 18): string {
  const trimmed = value.trim()
  if (trimmed.length >= length) return trimmed
  return trimmed.padStart(length, "0")
}

/**
 * Strip leading zeros back to the "external" short form (inverse-ish of padNumericId).
 * Never strips down to an empty string — a value of all zeros stays "0".
 */
export function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, "")
  return stripped.length ? stripped : "0"
}

export type DateFormat = "MM/DD/YYYY" | "YYYY-MM-DD" | "DD.MM.YYYY"

/**
 * Resolve a relative-date token against "now" (or an injected reference date, for
 * deterministic unit tests) and render it in the requested format.
 *
 * Supported tokens:
 *   "today"      -> now
 *   "+30d"       -> now + 30 days
 *   "-5d"        -> now - 5 days
 * Anything else is returned unchanged (so a literal absolute date string like
 * "01/01/2020" — used intentionally by boundary/backdated cases — passes through).
 */
export function relativeDate(
  token: string,
  format: DateFormat = "MM/DD/YYYY",
  referenceDate: Date = new Date()
): string {
  const m = /^([+-]\d+)d$/.exec(token.trim())
  let d: Date
  if (token.trim().toLowerCase() === "today") {
    d = new Date(referenceDate)
  } else if (m) {
    d = new Date(referenceDate)
    d.setDate(d.getDate() + parseInt(m[1], 10))
  } else {
    return token // not a recognized token — pass through literally
  }
  return formatDate(d, format)
}

function formatDate(d: Date, format: DateFormat): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const yyyy = String(d.getFullYear())
  switch (format) {
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`
    case "DD.MM.YYYY":
      return `${dd}.${mm}.${yyyy}`
    case "MM/DD/YYYY":
    default:
      return `${mm}/${dd}/${yyyy}`
  }
}

/** True if a string looks like one of the relative-date tokens relativeDate() understands. */
export function isRelativeDateToken(value: string): boolean {
  const t = value.trim().toLowerCase()
  return t === "today" || /^[+-]\d+d$/.test(t)
}
