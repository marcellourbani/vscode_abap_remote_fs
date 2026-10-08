/**
 * Browser SSO Authentication
 *
 * For SAP systems using SAML 2.0 or Kerberos SSO where direct protocol
 * integration isn't feasible. Opens a local helper page in the browser,
 * lets the user authenticate against the SAP system in a separate tab,
 * then captures pasted session cookies via a local HTTP callback server.
 *
 * Flow:
 *  1. Extension starts a local HTTP server on a random port
 *  2. Opens the local helper page in the user's default browser
 *  3. User opens the SAP system from the helper page and authenticates via IdP
 *  4. User pastes the resulting cookies into the helper page, which POSTs
 *     them back to the localhost callback
 *  5. Extension captures MYSAPSSO2 / SAP_SESSIONID cookies
 *  6. Subsequent ADT requests use those cookies
 *
 * Cookie storage: PasswordVault (OS credential store)
 */

import * as http from "http"
import { randomBytes } from "crypto"
import { type AuthResult } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"
import * as vscode from "vscode"
import { buildCookieHeaders, sanitizeCookie, toStringArray } from "./utils"

const VAULT_SERVICE = "vscode.abapfs.browsersso"

const VAULT_TS_SERVICE = "vscode.abapfs.browsersso.ts"
// Callers for one connection share a single browser prompt. The generation makes cancellation
// final even if an older capture finishes after its HTTP server was asked to stop.
const captureLocks = new Map<string, { pending: Promise<string[]>; controller: AbortController }>()
const captureGenerations = new Map<string, number>()

interface CookieCaptureRequest {
  cookies?: string
}

function getListeningPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Cookie capture server did not expose a TCP port")
  }
  return address.port
}

function captureCookiesOnce(connId: string, loginUrl: string): Promise<string[]> {
  const connectionKey = formatKey(connId)
  const generation = captureGenerations.get(connectionKey) ?? 0
  let capture = captureLocks.get(connectionKey)
  if (!capture) {
    const controller = new AbortController()
    const pending = startCookieCaptureServer(
      loginUrl,
      5 * 60_000,
      vscodeSsoNotify,
      controller.signal
    )
      .then(async cookies => {
        // Check on both sides of the vault write so a disconnect cannot publish a late result.
        if (controller.signal.aborted) throw new vscode.CancellationError()
        await storeSsoCookies(connId, cookies)
        if (controller.signal.aborted) throw new vscode.CancellationError()
        return cookies
      })
      .finally(() => {
        if (captureLocks.get(connectionKey)?.controller === controller)
          captureLocks.delete(connectionKey)
      })
    capture = { pending, controller }
    captureLocks.set(connectionKey, capture)
  }
  return capture.pending.then(cookies => {
    if ((captureGenerations.get(connectionKey) ?? 0) !== generation)
      throw new vscode.CancellationError()
    return cookies
  })
}

export async function cancelBrowserSsoCapture(connId: string) {
  const connectionKey = formatKey(connId)
  // Invalidate every waiter before aborting the shared capture.
  captureGenerations.set(connectionKey, (captureGenerations.get(connectionKey) ?? 0) + 1)
  const capture = captureLocks.get(connectionKey)
  if (!capture) return
  capture.controller.abort()
  await capture.pending.catch(() => undefined)
}

export async function cancelAllBrowserSsoCaptures() {
  await Promise.all([...captureLocks.keys()].map(cancelBrowserSsoCapture))
}

/** Store SSO cookies securely. */
export async function storeSsoCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
  log.debug(`[browser-sso] Stored ${cookies.length} cookies for ${connId}`)
}

/** Retrieve stored SSO cookies; SAP validates them when a client connects. */
export async function getSsoCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[browser-sso] No cached cookies for ${connId}`)
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    const result = toStringArray(parsed)
    log.debug(`[browser-sso] Retrieved ${result.length} cached cookies for ${connId}`)
    return result
  } catch (e) {
    log.debug(`[browser-sso] Failed to parse cached cookies for ${connId}: ${e}`)
    return []
  }
}

/** Clear stored SSO cookies. */
export async function clearSsoCookies(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  await vault.deletePassword(VAULT_TS_SERVICE, formatKey(connId))
  log.debug(`[browser-sso] Cleared cached cookies for ${connId}`)
}

/**
 * Start a temporary local HTTP server that serves a helper page and
 * receives cookies POSTed from the browser. Returns captured cookies.
 *
 * Security notes:
 *  - Binds to 127.0.0.1 loopback only (not accessible from network)
 *  - Uses a random one-time token in the URL to prevent cross-origin
 *    requests from other browser tabs injecting fake cookies
 *  - No CORS headers — the helper page is served from the same origin
 *    so cross-origin restrictions apply naturally
 *
 * @param sapUrl     The SAP URL to open in the browser for SSO
 * @param timeoutMs  Capture deadline (default five minutes)
 * @param notifyUser Optional callback to show the helper URL to the user if browser launch fails
 */
export function startCookieCaptureServer(
  sapUrl: string,
  timeoutMs = 5 * 60_000,
  notifyUser?: (helperUrl: string) => void,
  signal?: AbortSignal
): Promise<string[]> {
  // Random token that must be present in POST to prevent cross-origin cookie injection
  const token = randomBytes(24).toString("hex")

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new vscode.CancellationError())
      return
    }
    let deadline = Date.now() + timeoutMs
    let timer: ReturnType<typeof setTimeout>
    let settled = false
    const server = http.createServer((req, res) => {
      if (settled) {
        res.writeHead(410)
        res.end("Login is no longer active.")
        return
      }
      if (Date.now() >= deadline) {
        res.writeHead(410)
        res.end("Login timed out. Run Connect again.")
        expire()
        return
      }
      // Only serve the helper page at the token URL
      if (req.method === "GET" && req.url === `/${token}`) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(getHelperPageHtml(sapUrl, token, deadline))
        return
      }

      if (req.method === "POST" && req.url === `/${token}/extend`) {
        deadline = Date.now() + timeoutMs
        clearTimeout(timer)
        timer = setTimeout(expire, timeoutMs)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ deadline }))
        return
      }

      if (req.method === "POST" && req.url === `/${token}/cancel`) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ message: "Login cancelled." }))
        settled = true
        clearTimeout(timer)
        server.close()
        reject(new vscode.CancellationError())
        return
      }

      if (req.method === "POST" && req.url === `/${token}/cookies`) {
        let body = ""
        let rejected = false
        req.on("data", (chunk: Buffer) => {
          const chunkText = chunk.toString("utf8")
          // Check before appending to reliably enforce the limit
          if (rejected || body.length + chunkText.length > 8192) {
            if (!rejected) {
              rejected = true
              res.writeHead(413)
              res.end("Payload too large")
              req.destroy()
            }
            return
          }
          body += chunkText
        })
        req.on("end", () => {
          if (rejected) return
          if (settled) {
            res.writeHead(410)
            res.end("Login is no longer active.")
            return
          }
          try {
            const data = JSON.parse(body) as CookieCaptureRequest
            // Sanitize cookies: strip CR/LF to prevent HTTP header injection
            const cookieString = typeof data.cookies === "string" ? data.cookies : ""
            const cookies = cookieString
              .split(";")
              .map(cookie => sanitizeCookie(cookie))
              .filter(cookie => cookie.includes("=") && cookie.length <= 4096)

            if (cookies.length === 0) {
              log.debug(`[browser-sso] POST received but no cookies extracted`)
              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(
                JSON.stringify({
                  captured: false,
                  message: "No cookies received. Make sure you are logged in."
                })
              )
              return
            }

            log.debug(
              `[browser-sso] Captured ${cookies.length} cookies: ${cookies.map(c => c.split("=")[0]).join(",")}`
            )
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(
              JSON.stringify({
                captured: true,
                message: `Captured ${cookies.length} cookies. You can close this tab.`
              })
            )

            settled = true
            clearTimeout(timer)
            server.close()
            resolve(cookies)
          } catch (e) {
            log.debug(`[browser-sso] Failed to parse POST body: ${e}`)
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ message: "Invalid request" }))
          }
        })
        return
      }

      res.writeHead(404)
      res.end("Not found")
    })

    // Listen on a random available port on loopback only
    server.listen(0, "127.0.0.1", () => {
      if (settled) {
        server.close()
        return
      }
      const helperUrl = `http://127.0.0.1:${getListeningPort(server)}/${token}`

      // Open in the user's default browser; only show notification as fallback
      Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(helperUrl)))
        .then(opened => {
          if (opened) log.debug(`[browser-sso] Browser opened successfully for: ${helperUrl}`)
          else {
            log.debug(
              `[browser-sso] VS Code declined to open browser, showing notification fallback`
            )
            if (notifyUser) notifyUser(helperUrl)
          }
        })
        .catch((err: unknown) => {
          log.debug(`[browser-sso] Failed to open browser (${err}), showing notification fallback`)
          if (notifyUser) notifyUser(helperUrl)
        })
    })

    function expire() {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      reject(new Error("Browser SSO timed out. Run Connect again to retry."))
    }
    timer = setTimeout(expire, timeoutMs)

    signal?.addEventListener(
      "abort",
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (server.listening) server.close()
        reject(new vscode.CancellationError())
      },
      { once: true }
    )

    server.on("error", err => {
      settled = true
      clearTimeout(timer)
      reject(new Error(`Cookie capture server error: ${err.message}`))
    })
  })
}

/** Default VS Code notification callback for browser SSO. */
function vscodeSsoNotify(helperUrl: string) {
  vscode.window
    .showInformationMessage(
      "Browser SSO: Complete login in the browser window, then paste cookies into the helper page.",
      "Open Browser Page"
    )
    .then((choice: string | undefined) => {
      if (choice === "Open Browser Page") {
        vscode.env.openExternal(vscode.Uri.parse(helperUrl))
      }
    })
}

/**
 * Build an AuthResult using stored or freshly captured SSO cookies.
 */
export async function buildBrowserSsoAuth(
  connId: string,
  sapUrl: string,
  sapClient: string
): Promise<AuthResult> {
  log.debug(`[browser-sso] buildBrowserSsoAuth starting for ${connId}`)
  const generation = captureGenerations.get(formatKey(connId)) ?? 0
  let cookies = await getSsoCookies(connId)
  if ((captureGenerations.get(formatKey(connId)) ?? 0) !== generation)
    throw new vscode.CancellationError()
  if (cookies.length === 0) {
    log.debug(`[browser-sso] No cached cookies, starting cookie capture for ${connId}`)
    cookies = await captureBrowserSsoCookies(connId, sapUrl, sapClient)
  }

  const headers = buildCookieHeaders(cookies)

  log.debug(`[browser-sso] buildBrowserSsoAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "browser-sso",
    ...(headers ? { headers } : {})
  }
}

/** Open the browser login and store the captured cookies, joining a login already open. */
export function captureBrowserSsoCookies(connId: string, sapUrl: string, sapClient: string) {
  // This lightweight ADT endpoint establishes the SAP session without loading repository data.
  const loginUrl = `${sapUrl}/sap/bc/adt/compatibility/graph?sap-client=${encodeURIComponent(sapClient)}`
  return captureCookiesOnce(connId, loginUrl)
}

/** Generate the helper HTML page for cookie capture. */
function getHelperPageHtml(sapUrl: string, token: string, deadline: number): string {
  // Validate URL protocol before embedding — reject javascript: or data: URIs
  if (!/^https?:\/\//i.test(sapUrl)) {
    sapUrl = "about:blank" // Safe fallback; should never reach here in normal operation
  }
  // Escape the SAP URL for safe embedding in HTML
  const escapedUrl = sapUrl
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline';">
  <title>ABAP FS — Browser SSO Login</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           max-width: 600px; margin: 60px auto; padding: 20px; color: #333; }
    h1 { font-size: 20px; margin-bottom: 12px; }
    .step { margin: 16px 0; padding: 12px; background: #f5f5f5; border-radius: 6px; }
    .step b { color: #0066cc; }
    textarea { width: 100%; height: 80px; margin: 8px 0; font-family: monospace; font-size: 12px; }
    button { padding: 10px 20px; background: #0066cc; color: #fff; border: none;
             border-radius: 4px; font-size: 14px; cursor: pointer; }
    button:hover { background: #0052a3; }
    button.secondary { background: #eee; color: #333; }
    button.secondary:hover { background: #ddd; }
    #timer { margin: 16px 0; font-variant-numeric: tabular-nums; }
    .success { color: #28a745; font-weight: bold; display: none; }
    .error { color: #dc3545; display: none; }
  </style>
</head>
<body>
  <h1>ABAP FS — Browser SSO Login</h1>
  <p id="timer" role="status" aria-live="polite"></p>
  <button class="secondary" id="extend" onclick="extendTimer()">Extend time</button>
  <div class="step">
    <b>Step 1:</b> <a href="${escapedUrl}" target="_blank" rel="noopener">Click here to open your SAP system</a>
    and complete the SSO login in the popup window.
  </div>
  <div class="step">
    <b>Step 2:</b> After you are logged in, open browser DevTools (F12) → Application → Cookies,
    and copy all cookies for the SAP domain. Paste them below:
    <textarea id="cookieInput" placeholder="Paste cookies here (name=value; name2=value2; ...)"></textarea>
    <button id="submit" onclick="submitCookies()">Submit Cookies</button>
  </div>
  <button class="secondary" id="cancel" onclick="cancelLogin()">Cancel login</button>
  <p class="success" id="success"></p>
  <p class="error" id="error"></p>
  <script>
    var deadline = ${deadline};
    function updateTimer() {
      var seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      document.getElementById('timer').textContent = seconds
        ? 'Time remaining: ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
        : 'Login timed out. Run Connect again to retry.';
      document.getElementById('extend').disabled = !seconds;
      document.getElementById('submit').disabled = !seconds;
      document.getElementById('cancel').disabled = !seconds;
    }
    var countdown = setInterval(updateTimer, 1000);
    updateTimer();
    function finish(message) {
      clearInterval(countdown);
      document.getElementById('timer').textContent = message;
      document.getElementById('extend').disabled = true;
      document.getElementById('submit').disabled = true;
      document.getElementById('cancel').disabled = true;
    }
    function extendTimer() {
      fetch('/${token}/extend', { method: 'POST' })
        .then(function(r) { if (!r.ok) throw new Error('Unable to extend time'); return r.json(); })
        .then(function(data) { deadline = data.deadline; updateTimer(); })
        .catch(function(e) { finish('Login session unavailable. Run Connect again to retry.'); document.getElementById('error').textContent = String(e); document.getElementById('error').style.display = 'block'; });
    }
    function cancelLogin() {
      fetch('/${token}/cancel', { method: 'POST' })
        .then(function(r) { if (!r.ok) throw new Error('Unable to cancel login'); return r.json(); })
        .then(function(data) { finish(data.message); })
        .catch(function(e) { document.getElementById('error').textContent = String(e); document.getElementById('error').style.display = 'block'; });
    }
    function submitCookies() {
      var cookies = document.getElementById('cookieInput').value.trim();
      if (!cookies) { document.getElementById('error').textContent = 'Please paste cookies first.'; document.getElementById('error').style.display = 'block'; return; }
      fetch('/${token}/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookies })
      })
      .then(function(r) { if (!r.ok) throw new Error('Login session expired'); return r.json(); })
      .then(function(d) {
        if (!d.captured) {
          document.getElementById('error').textContent = d.message;
          document.getElementById('error').style.display = 'block';
          return;
        }
        finish(d.message);
        document.getElementById('success').textContent = d.message;
        document.getElementById('success').style.display = 'block';
        document.getElementById('error').style.display = 'none';
      })
      .catch(function(e) {
        document.getElementById('error').textContent = 'Error: ' + e + '. Run Connect again if the timer expired.';
        document.getElementById('error').style.display = 'block';
      });
    }
  </script>
</body>
</html>`
}
