/**
 * SAP runtime-error / short-dump detector.
 *
 * SAP GUI for HTML (ITS) never renders a short dump as a role="dialog" popup.
 * The behavior depends on where the failure happened:
 *
 *  A. Full-page short dump (classic ABAP RUNTIME ERROR): the whole browser
 *     document is replaced with a red-themed page whose <title> and top-of-body
 *     text contain phrases like "ABAP Runtime Error", "Runtime Errors", or the
 *     dump category (e.g. MESSAGE_TYPE_X, TSV_TNEW_PAGE_ALLOC_FAILED).
 *
 *  B. ITS-level error (500 Internal Server Error, ITS Error): the outer page
 *     shows an ICM/ITS error banner; the URL sometimes carries `~error=` but not
 *     always. Title becomes "500 Internal Server Error", "SAP GUI - Error",
 *     or similar.
 *
 *  C. Silent transaction bounce: SAP sometimes doesn't error at all — it just
 *     drops the user back to SAP Easy Access (Screen SAPMSYST/40, Transaction
 *     S000). Not a dump, but often a symptom of an auth/authorization failure
 *     the test should notice. `detectSessionLost` covers this.
 *
 * Detection is intentionally cheap: cheap enough to run after every guarded()
 * action without adding meaningful overhead. Everything is a substring match on
 * strings we've already collected for other reasons.
 *
 * Fail-safe: if a check itself throws, we return null (no dump). A silent
 * detector bug must not cause every test to fail; a missed dump will surface
 * as the test's own assertion failing loudly on the next expectAlert/expectTitle.
 */
import type { Page } from "@playwright/test"

export type RuntimeError = {
  /**
   * `dump`   — ABAP short dump (Category A).
   * `its`    — ITS/ICM protocol error (Category B).
   * `logon`  — session dropped to login screen; user needs to authenticate.
   */
  kind: "dump" | "its" | "logon"
  title: string
  url: string
  /** First ~500 chars of the error body — safe to attach to test evidence. */
  snippet: string
}

/**
 * Substrings that ONLY appear on real short-dump / ITS-error pages, never in a
 * healthy SAP screen. Case-insensitive. Keep this list narrow — a false
 * positive here fails every subsequent test.
 */
const DUMP_TITLE_SIGNATURES = [
  "ABAP Runtime Error",
  "Runtime Errors",
  "500 Internal Server Error",
  "500 SAP Internal Server Error",
  "SAP GUI - Error",
  "ITS Error",
  "Session Terminated",
  "Web Dynpro Component - Runtime Error"
]

/**
 * Body-text substrings that appear on a rendered short-dump / ITS error page.
 * These live in the OUTER document body (or the iframe's body when a dump
 * escapes into the frame). They're distinctive enough that no normal SAP
 * screen contains them.
 */
const DUMP_BODY_SIGNATURES = [
  "The current ABAP program",
  "Category               ABAP programming error",
  "Runtime Errors",
  "Short dump has not been completely stored",
  "The system service returned an unexpected exception",
  "ITS Error",
  "URL http://" // often paired with the above on ITS error banners
]

/**
 * URL-path fragments that only appear on error redirects.
 * Note: `~error=` isn't universal — different SAP releases render dumps in
 * place without changing the URL — so URL alone is not sufficient evidence.
 */
const DUMP_URL_SIGNATURES = [
  "~error=",
  "/its/error",
  "/sap/public/bc/its/mimes/system/99/system_error"
]

const LOGON_SCREEN_SIGNATURES = [
  "SAP NetWeaver Logon",
  "SAP Logon",
  "Please log on again",
  "Session ended"
]

/**
 * Structural logon check, because the title alone is not dependable: SAP's WebGUI logon page
 * is served from the SAME url as the application and on some systems carries a title that
 * matches none of the signatures above, so a title-only test lets an unauthenticated session
 * through as if it were healthy.
 *
 * A visible password box is the one thing a logon screen always has and an application screen
 * never does — SAP renders its own password-change dialogs inside the ITS iframe, whereas the
 * logon page replaces the whole document.
 */
async function hasLogonForm(page: Page): Promise<boolean> {
  try {
    return await page.locator('input[type="password"]').first().isVisible({ timeout: 1000 })
  } catch {
    return false
  }
}

async function safeTitle(page: Page): Promise<string> {
  try {
    return (await page.title()) ?? ""
  } catch {
    return ""
  }
}

async function safeUrl(page: Page): Promise<string> {
  try {
    return page.url()
  } catch {
    return ""
  }
}

async function safeOuterBody(page: Page): Promise<string> {
  try {
    // innerText, capped — huge dumps can be tens of KB.
    const text = await page
      .locator("body")
      .evaluate(el => ((el as HTMLElement).innerText || "").slice(0, 2000))
      .catch(() => "")
    return text ?? ""
  } catch {
    return ""
  }
}

function matchAny(haystack: string, needles: string[]): string | null {
  const lower = haystack.toLowerCase()
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n
  }
  return null
}

/**
 * Cheap runtime-error check. Returns `null` when the page looks healthy.
 *
 * Intended to be called from `guarded()` after every action. Cost is one
 * page.title(), one page.url(), and (only if a title/url signature hits) one
 * body.innerText slice.
 */
export async function detectRuntimeError(page: Page): Promise<RuntimeError | null> {
  const [url, title] = await Promise.all([safeUrl(page), safeTitle(page)])

  // 1) Cheapest check: URL signatures
  const urlHit = matchAny(url, DUMP_URL_SIGNATURES)

  // 2) Title signatures
  const dumpTitleHit = matchAny(title, DUMP_TITLE_SIGNATURES)
  const logonTitleHit = matchAny(title, LOGON_SCREEN_SIGNATURES)

  if (!urlHit && !dumpTitleHit && !logonTitleHit) {
    // 3) A logon screen that named itself nothing recognisable still has a password box.
    if (await hasLogonForm(page)) {
      return {
        kind: "logon",
        title: title || "SAP logon screen",
        url,
        snippet: (await safeOuterBody(page)).slice(0, 500)
      }
    }
    // 4) Fallback: body-text signatures. Only run this on outer document —
    //    inside-iframe body is expensive to snapshot, and real dumps replace
    //    the whole document.
    const body = await safeOuterBody(page)
    const bodyHit = matchAny(body, DUMP_BODY_SIGNATURES)
    if (!bodyHit) return null
    return {
      kind: "dump",
      title: title || bodyHit,
      url,
      snippet: body.slice(0, 500)
    }
  }

  const body = await safeOuterBody(page)
  if (logonTitleHit) {
    return {
      kind: "logon",
      title: title || logonTitleHit,
      url,
      snippet: body.slice(0, 500)
    }
  }

  const kind: RuntimeError["kind"] =
    url.includes("/its/error") || title.toLowerCase().includes("its error") ? "its" : "dump"
  return {
    kind,
    title: title || dumpTitleHit || urlHit || "SAP runtime error",
    url,
    snippet: body.slice(0, 500)
  }
}

/**
 * Detects the "silent bounce" case: SAP dropped the user back to SAP Easy
 * Access (transaction S000) even though the test tried to open a different
 * transaction. Usually means the transaction doesn't exist in this client,
 * the user lacks S_TCODE for it, or a prior action aborted.
 *
 * This is NOT called from guarded() (Easy Access is a valid state for
 * `sap.open()`), but exposed for `openTx()` to verify the tx actually loaded.
 *
 * Detection strategy — three OR'd signals, verified live:
 *
 *  1. `document.title === "SAP Easy Access"` — the healthy home-screen title.
 *     UNIQUE to Easy Access; ME21N sets it to "Create Purchase Order", SE16 to
 *     "Data Browser: Initial Screen", etc. Cheapest signal.
 *  2. In-frame "SAPMSYST/40" text — the error-variant Easy Access shown when
 *     SAP tried to launch an invalid tx and dumped the user back to the shell
 *     with the debug info panel visible.
 *  3. In-frame "Start SAP Easy Access" text — appears in the shell's user-menu
 *     shortcut on some system-info panel variants.
 *
 * Note we deliberately DO NOT use "Enter transaction code" as a signal — that
 * textbox exists on the top toolbar of EVERY classic dynpro screen (verified
 * on ME21N and SE16 in live exploration), so it's meaningless as a bounce
 * indicator.
 *
 * OR semantics: a false positive here fails one openTx call with a clear
 * error; a false negative silently runs the whole test against the wrong
 * screen and fails much later with a confusing selector error. False
 * positives are strictly better.
 */
export async function detectSilentBounce(
  page: Page,
  expectedTx: string
): Promise<{ actualScreen: string } | null> {
  try {
    // Opening S000 or SESSION_MANAGER intentionally IS Easy Access — not a bounce.
    const expected = expectedTx.replace(/^\*/, "").toUpperCase()
    if (expected === "S000" || expected === "SESSION_MANAGER") return null

    // Signal 1: cheapest — document.title. Only true on Easy Access.
    const docTitle = await page.title().catch(() => "")
    if (/^SAP Easy Access$/i.test(docTitle.trim())) {
      return { actualScreen: "SAP Easy Access" }
    }

    const frame = page.frameLocator("iframe").first()

    // Signal 2: error-variant Easy Access shows SAPMSYST/40 in the debug panel.
    const sapmsystHit = await frame
      .getByText("SAPMSYST/40")
      .count()
      .catch(() => 0)
    if (sapmsystHit > 0) return { actualScreen: "SAP Easy Access (error variant)" }

    // Signal 3: shell shortcut, appears on some info-panel variants.
    const easyAccessShortcut = await frame
      .getByText(/Start SAP Easy Access/)
      .count()
      .catch(() => 0)
    if (easyAccessShortcut > 0) return { actualScreen: "SAP Easy Access (shell)" }

    return null
  } catch {
    return null
  }
}
