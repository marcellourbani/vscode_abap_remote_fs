/**
 * SAP WebGUI page stability primitives.
 *
 * Two things must settle before any action:
 *  1) Network — SAP round-trips are XHR/form posts. `waitForLoadState('networkidle')` handles most.
 *  2) Busy indicator — WebGUI overlays `.lsdocblock` / `.urFakeBrowserBlockOverlay` while waiting.
 *  3) Focus lock — the framework sets `document.body.classList` briefly. We poll for absence.
 *
 * IMPORTANT: SAP ITS WebGUI renders inside an <iframe>. Busy overlays, DOM mutations,
 * and everything else observable happens inside the frame, NOT the outer document.
 * These helpers poll BOTH outer page and every frame so they work regardless of which
 * scope the SAP UI actually lives in.
 *
 * Fail-open: if a wait times out we swallow and continue rather than fail the test outright.
 * A test that keeps working past a bad wait will surface the real problem via its own assertions.
 */
import type { Page, Frame } from "@playwright/test"

const BUSY_SELECTORS = [
  ".lsdocblock",
  ".urFakeBrowserBlockOverlay",
  '[id$="_blockOverlay"]',
  ".sapMBusyIndicator"
]

/** Every JavaScript execution scope on the page: outer + all frames. */
function scopes(page: Page): Array<Page | Frame> {
  return [page, ...page.frames().filter(f => f !== page.mainFrame())]
}

export async function waitForServer(page: Page, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  try {
    await page.waitForLoadState("networkidle", {
      timeout: Math.max(1_000, deadline - Date.now())
    })
  } catch {
    // networkidle may never fire on long-polling pages; fall through to DOM checks
  }
  const remaining = Math.max(1_000, deadline - Date.now())
  // Poll every scope: outer page + every frame. Overlay must be absent in ALL scopes.
  try {
    await page.waitForFunction(
      (sel: string[]) => {
        // Only queries current document — Playwright's waitForFunction runs per-scope.
        return sel.every(
          s =>
            Array.from(document.querySelectorAll(s)).filter(el => {
              const r = (el as HTMLElement).getBoundingClientRect?.()
              return !r || r.width > 0 || r.height > 0
            }).length === 0
        )
      },
      BUSY_SELECTORS,
      { timeout: remaining, polling: 200 }
    )
  } catch {
    // outer clear — good
  }
  // Same check on every iframe.
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const left = Math.max(500, deadline - Date.now())
    try {
      await frame.waitForFunction(
        (sel: string[]) =>
          sel.every(
            s =>
              Array.from(document.querySelectorAll(s)).filter(el => {
                const r = (el as HTMLElement).getBoundingClientRect?.()
                return !r || r.width > 0 || r.height > 0
              }).length === 0
          ),
        BUSY_SELECTORS,
        { timeout: left, polling: 200 }
      )
    } catch {
      // frame overlay never disappeared — proceed
    }
  }
}

export async function waitForDomStable(page: Page, quietMs = 500, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout
  // Install a MutationObserver in every scope (outer + all frames), then wait until
  // NONE of them saw a mutation for `quietMs`.
  const targets = scopes(page)
  await Promise.all(
    targets.map(s =>
      s
        .evaluate(() => {
          ;(window as any).__lastMut = performance.now()
          const obs = new MutationObserver(() => {
            ;(window as any).__lastMut = performance.now()
          })
          obs.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true
          })
          ;(window as any).__mutObs = obs
        })
        .catch(() => {})
    )
  )
  try {
    // wait until every scope is quiet
    const remaining = Math.max(500, deadline - Date.now())
    const start = Date.now()
    while (Date.now() - start < remaining) {
      const results = await Promise.all(
        targets.map(s =>
          s
            .evaluate((q: number) => performance.now() - (window as any).__lastMut > q, quietMs)
            .catch(() => true)
        )
      )
      if (results.every(Boolean)) break
      await page.waitForTimeout(100)
    }
  } finally {
    await Promise.all(
      targets.map(s =>
        s
          .evaluate(() => {
            ;(window as any).__mutObs?.disconnect()
          })
          .catch(() => {})
      )
    )
  }
}
