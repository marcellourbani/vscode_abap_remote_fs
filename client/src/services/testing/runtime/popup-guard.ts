/**
 * Popup guard — dismisses interrupting dialogs that are NOT part of the test flow.
 *
 * SAP WebGUI throws several categories of unexpected popups:
 *   - Session/license warnings after inactivity
 *   - Multiple-logon dialog when the same user has a session elsewhere
 *   - System broadcast messages
 *   - GDPR / data-privacy acceptance
 *
 * Deliberately NOT auto-dismissed:
 *   - "Exit Document" / "Do you want to save?" — tests may legitimately want to
 *     save unsaved data. Handle this from the spec via `sap.clickButton("Yes")`
 *     or `sap.clickButton("No")` inside the dialog, or pass it as an
 *     `extraInterrupter` for THIS specific test if you want auto-dismissal.
 *   - "Information" — appears on countless real dialogs users need to see.
 *
 * IMPORTANT: SAP ITS renders everything inside an <iframe>, and dialogs are
 * <div class="lsPopupWindow"> / <div class="lsShellPopup"> — they carry NO
 * role="dialog" and NO aria-label. Titles live in `.urPWTitleText`; action
 * buttons are `<div title="Yes">` / `<div title="No">` — NOT ARIA buttons.
 * Empirical evidence from ME21N "Exit Document" dialog:
 * `getByRole("button", { name: "No" })` finds ZERO matches; only `[title="No"]` works.
 *
 * The guard runs before AND after every action. If it finds a dialog whose title
 * matches a known "safe to dismiss" pattern, it clicks the configured button.
 * Unknown dialogs are LEFT ALONE — swallowing them silently would hide bugs.
 *
 * IMPORTANT: If a KNOWN pattern is matched but the configured button can't be
 * clicked, the guard THROWS with an actionable error rather than silently
 * leaving the dialog open. A dead-code "silently ignore" branch caused the
 * previous version's next action to fail with an unrelated locator error.
 *
 * To add a new pattern: append to KNOWN_INTERRUPTERS. `matchTitle` is a substring
 * (case-insensitive) — keep it specific enough not to false-match real dialogs.
 */
import type { Page, Frame, Locator } from "@playwright/test"

export type Interrupter = {
  /** Case-insensitive substring of the dialog title (from `.urPWTitleText` or aria-label). */
  matchTitle: string
  /** Exact button label — matched against the ITS `<div title="X">` attribute. */
  dismissButton: string
  /** One-line explanation used in DismissedPopup log entries. */
  note: string
}

/**
 * Dialogs we've confirmed safe to auto-dismiss on any SAP screen.
 *
 * Rules for additions:
 *  - `matchTitle` MUST be specific enough that no interactive dialog matches it
 *    accidentally. `"Information"` is deliberately NOT included — it appears on
 *    countless real dialogs the user needs to see.
 *  - `dismissButton` must be the button's actual `title` attribute (case-sensitive).
 *  - If your program surfaces its own auto-dismissible popup, pass it via
 *    `SapSessionOptions.extraInterrupters` instead of editing this list.
 */
export const KNOWN_INTERRUPTERS: Interrupter[] = [
  {
    matchTitle: "License",
    dismissButton: "Continue",
    note: "SAP license/EULA reminder — safe to continue."
  },
  {
    matchTitle: "System messages",
    dismissButton: "Continue",
    note: "System broadcast messages (SM02)."
  },
  {
    matchTitle: "Multiple Logon",
    dismissButton: "Continue with this logon and end any other logons in the system",
    note: "Same user has another session — end the other so this one wins. Critical for parallel CI."
  },
  {
    matchTitle: "Copyright",
    dismissButton: "Continue",
    note: "Legal notice shown once per client on some systems."
  },
  {
    matchTitle: "Data Privacy",
    dismissButton: "Accept",
    note: "GDPR / data-processing consent on modern S/4 systems."
  },
  {
    matchTitle: "Password",
    dismissButton: "Cancel",
    note: "Cancel password-expiration reminders — do NOT allow tests to change credentials silently."
  }
]

export type DismissedPopup = { title: string; button: string; at: string }

/** Selectors that identify a dialog in Fiori/UI5 (role) or ITS (class-based). */
const DIALOG_SELECTORS =
  '[role="dialog"], [role="alertdialog"], .lsPopupWindow, .lsShellPopup, [class*="urDlgFrame"]'

/** Every JS scope on the page: outer + all frames. Dialogs may appear in either. */
function scopes(page: Page): Array<Page | Frame> {
  return [page, ...page.frames().filter(f => f !== page.mainFrame())]
}

/**
 * Read a dialog title. Handles four rendering variants:
 *   - Fiori/UI5:              aria-label on the dialog element
 *   - Fiori/UI5 alternative:  aria-labelledby pointing to a heading
 *   - ITS classic:            .urPWTitleText (a <div> inside .urPWTitle)
 *   - Generic ARIA heading:   h1/h2 inside the dialog
 *
 * Returns "" when nothing usable is found. Callers must treat "" as "unknown"
 * and NOT auto-dismiss.
 */
async function readDialogTitle(dlg: Locator): Promise<string> {
  const aria = await dlg.getAttribute("aria-label").catch(() => null)
  if (aria) return aria.trim()

  const labelledBy = await dlg.getAttribute("aria-labelledby").catch(() => null)
  if (labelledBy) {
    // Look up the referenced element inside the same dialog root.
    const inside = await dlg
      .locator(`#${CSS.escape(labelledBy)}`)
      .first()
      .textContent()
      .catch(() => null)
    if (inside && inside.trim()) return inside.trim()
  }

  // ITS: `.urPWTitleText` (the actual title <div>).
  // Also catch `[class*='TitleText']` for other themes/versions.
  // Also `h1/h2` for genuine ARIA headings.
  const header = await dlg
    .locator("h1, h2, .urPWTitleText, [class*='TitleText']")
    .first()
    .textContent()
    .catch(() => null)
  return (header ?? "").trim()
}

/**
 * Try to click the given dismiss button INSIDE a dialog.
 *
 * Empirically-ranked strategies (evidence from live ME21N exploration):
 *  1. `[title="X"]` exact — the ONLY reliable strategy for ITS dialogs
 *     (their buttons are `<div title="Yes|No|Cancel">Label</div>` with no ARIA role).
 *  2. `[aria-label="X"]` exact — for themes that use aria-label instead of title.
 *  3. `getByRole("button", { name: X, exact: true })` — Fiori/UI5 only; will
 *     not match ITS `<div>` buttons but is safe to try.
 *
 * DELIBERATELY DROPPED from the previous version:
 *  - `text=X` selector — substring match; `text=No` matches "Note", "Not now".
 *  - `filter({ has: text=X })` chain — verified to return zero on real dialogs.
 *  - Regex-based `getByRole` — when we know the exact label, an exact match is
 *    safer than a regex that could partial-match "Cancel" vs "Cancel All".
 *
 * Returns true iff a button was actually clicked.
 */
async function clickDismissButton(dlg: Locator, buttonLabel: string): Promise<boolean> {
  const strategies: Locator[] = [
    dlg.locator(`[title="${buttonLabel}"]`),
    dlg.locator(`[aria-label="${buttonLabel}"]`),
    dlg.getByRole("button", { name: buttonLabel, exact: true })
  ]
  for (const s of strategies) {
    const count = await s.count().catch(() => 0)
    if (count === 0) continue
    try {
      await s.first().click({ timeout: 5_000, force: true })
      return true
    } catch {
      // fall through to next strategy
    }
  }
  return false
}

export async function dismissKnownPopups(
  page: Page,
  extra: Interrupter[] = []
): Promise<DismissedPopup[]> {
  const dismissed: DismissedPopup[] = []
  const patterns = [...KNOWN_INTERRUPTERS, ...extra]
  // Bounded loop — never chase more than 5 nested popups. Chain-of-popups happens
  // occasionally (e.g. Copyright → License → System messages on first login).
  for (let i = 0; i < 5; i++) {
    let acted = false

    for (const scope of scopes(page)) {
      const dialogs = await scope.locator(DIALOG_SELECTORS).all()
      if (dialogs.length === 0) continue

      for (const dlg of dialogs) {
        const title = await readDialogTitle(dlg)
        if (!title) continue // unnamed dialog — leave alone, might be F4 help

        const match = patterns.find(p => title.toLowerCase().includes(p.matchTitle.toLowerCase()))
        if (!match) continue

        const clicked = await clickDismissButton(dlg, match.dismissButton)
        if (!clicked) {
          // We RECOGNISED the dialog but couldn't dismiss it. Do NOT silently
          // pretend we handled it — that leaves the popup open and the next
          // helper call fails with an unrelated locator error.
          throw new Error(
            `Popup guard: recognised interrupter "${match.matchTitle}" ` +
              `(actual title: "${title}") but could not click its "${match.dismissButton}" button. ` +
              `Either the button label changed in your SAP version — update KNOWN_INTERRUPTERS or ` +
              `pass extraInterrupters — or the dialog is not actually the one we thought.`
          )
        }

        dismissed.push({
          title,
          button: match.dismissButton,
          at: new Date().toISOString()
        })
        acted = true
        break
      }
      if (acted) break
    }

    if (!acted) return dismissed
    // Small settle — SAP renders the follow-on popup with an async server hop.
    await page.waitForTimeout(300)
  }
  return dismissed
}

/**
 * Report the titles of currently-open dialogs. Use before EXPECTING a specific
 * screen (via `SapSession.expectNoDialog()`), NOT to make dismissal decisions.
 */
export async function listOpenDialogs(page: Page): Promise<string[]> {
  const out: string[] = []
  for (const scope of scopes(page)) {
    const dialogs = await scope.locator(DIALOG_SELECTORS).all()
    for (const d of dialogs) {
      const t = await readDialogTitle(d)
      out.push(t || "(untitled)")
    }
  }
  return out
}
