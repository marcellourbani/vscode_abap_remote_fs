// Loaded by @playwright/test's own CLI, not compiled by our build — plain CommonJS.
//
// Signs in once per run so every spec starts with an authenticated session. The playwright_test
// tool mints a one-shot loopback login URL in the extension host and passes it here; fetching it
// sets SAP's session cookie, which we save as storage state for the specs to reuse.
//
// This runs in globalSetup rather than in a spec on purpose: globalSetup is not traced, so the
// login never lands in a trace.zip written into the user's test folder.
const fs = require("fs")
const { chromium } = require("playwright")

/** A valid but empty state, so `use.storageState` always has a file to read. */
const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] })

/** Nothing here should ever take this long; better to run unauthenticated than to hang. */
const STEP_TIMEOUT_MS = 30_000

const since = start => `${Date.now() - start}ms`

module.exports = async () => {
  const loginUrl = process.env.SAP_TESTING_LOGIN_URL
  const statePath = process.env.SAP_TESTING_STORAGE_STATE
  if (!statePath) return
  if (!loginUrl) {
    console.log("[sso] no login URL — auto-login disabled for this connection")
    fs.writeFileSync(statePath, EMPTY_STATE)
    return
  }

  const started = Date.now()
  console.log("[sso] launching browser for auto-login")
  const browser = await chromium.launch({
    executablePath: process.env.SAP_TESTING_BROWSER_EXECUTABLE || undefined
  })
  console.log(`[sso] browser ready in ${since(started)}`)
  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Deliberately NOT waitUntil "networkidle": SAP WebGUI holds long-lived connections open,
    // so idle may never arrive.
    const navStarted = Date.now()
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS })

    // Wait for the session cookie itself, not for the URL to change. The page auto-submits a
    // form to myssocntl, so the URL leaves loopback the moment that POST commits — before SAP
    // has answered it and before any Set-Cookie has been applied. Polling the cookie jar waits
    // for the thing we actually need, instead of a proxy for it that can win the race.
    //
    // Filtered by the WebGUI URL, not just its host: Playwright returns "cookies that affect
    // those URLs", i.e. domain AND path AND secure all matched. So this asks the question that
    // actually matters — will a request to the URL the specs hit carry an auth cookie? — and a
    // cookie that fails to match is one the real request would not have sent either.
    const sapUrl = process.env[`SAP_URL_${(process.env.SAP_SYSTEM || "").toUpperCase()}`]
    const deadline = Date.now() + STEP_TIMEOUT_MS
    let cookies = []
    while (Date.now() < deadline) {
      cookies = sapUrl ? await context.cookies(sapUrl) : await context.cookies()
      if (cookies.length) break
      await page.waitForTimeout(250)
    }
    if (!cookies.length) {
      throw new Error(
        `SAP set no session cookie within ${STEP_TIMEOUT_MS}ms — the reentrance ticket was ` +
          `not accepted. Landed on ${page.url()}`
      )
    }
    console.log(
      `[sso] session cookie set in ${since(navStarted)}: ${cookies.map(c => c.name).join(", ")}`
    )

    await context.storageState({ path: statePath })
    console.log(`[sso] saved ${cookies.length} cookies (total ${since(started)})`)
  } catch (e) {
    // Never fail the run: the system may already authenticate by other means (gateway, SSO).
    // A genuinely unauthenticated session surfaces later as a logon-screen detection, which
    // reports far more usefully than a setup crash. Message only — it may quote a URL.
    console.error(`[sso] AUTO-LOGIN FAILED after ${since(started)}: ${(e && e.message) || e}`)
    console.error(
      "[sso] specs will run unauthenticated unless SAP authenticates them by other means"
    )
    fs.writeFileSync(statePath, EMPTY_STATE)
  } finally {
    await browser.close()
  }
}
