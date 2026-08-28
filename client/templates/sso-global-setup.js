// Loaded by @playwright/test's own CLI, not compiled by our build — plain CommonJS.
//
// Signs in once per run so every spec starts with an authenticated session. The abapfs_run_playwright_tests
// tool mints a one-shot loopback login form in the extension host; this setup fetches the form,
// POSTs it through Playwright's browserless request context, and saves the resulting cookie jar.
//
// This runs in globalSetup rather than in a spec on purpose: globalSetup is not traced, so the
// login never lands in a trace.zip written into the user's test folder.
const fs = require("fs")
const { request } = require("playwright")

/** A valid but empty state, so `use.storageState` always has a file to read. */
const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] })

/** Nothing here should ever take this long; fail the run rather than hang. */
const STEP_TIMEOUT_MS = 30_000
const since = start => `${Date.now() - start}ms`
const errorMessage = error => (error && error.message) || String(error)

const decodeHtml = value =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

function formValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = html.match(new RegExp(`<input[^>]+name="${escaped}"[^>]+value="([^"]*)"`, "i"))
  return match ? decodeHtml(match[1]) : undefined
}

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
  console.log("[sso] exchanging reentrance ticket without a browser")
  const api = await request.newContext()
  try {
    const launcher = await api.get(loginUrl, { timeout: STEP_TIMEOUT_MS })
    if (!launcher.ok()) throw new Error(`SSO launcher returned HTTP ${launcher.status()}`)
    const html = await launcher.text()
    const action = decodeHtml(html.match(/<form[^>]+action="([^"]+)"/i)?.[1] || "")
    const ticket = formValue(html, "sap-mysapsso")
    const redirect = formValue(html, "sap-mysapred")
    if (!action || !ticket) throw new Error("SSO launcher returned an invalid login form")

    const response = await api.post(action, {
      form: {
        "sap-mysapsso": ticket,
        ...(redirect ? { "sap-mysapred": redirect } : {})
      },
      maxRedirects: 0,
      timeout: STEP_TIMEOUT_MS
    })
    if (response.status() >= 400) {
      throw new Error(`SAP SSO exchange returned HTTP ${response.status()}`)
    }

    const state = await api.storageState()
    if (!state.cookies.length) throw new Error("SAP SSO exchange set no session cookie")
    fs.writeFileSync(statePath, JSON.stringify(state))
    console.log(
      `[sso] saved ${state.cookies.length} cookies in ${since(started)}: ` +
        state.cookies.map(cookie => cookie.name).join(", ")
    )
  } catch (e) {
    console.error(`[sso] AUTO-LOGIN FAILED after ${since(started)}: ${errorMessage(e)}`)
    throw e
  } finally {
    await api.dispose()
  }
}
