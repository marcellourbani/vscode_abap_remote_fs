/**
 * Browser SSO Authentication
 *
 * For SAP systems using SAML 2.0 or Kerberos SSO where direct protocol
 * integration isn't feasible. Opens a browser window to the SAP system,
 * lets the IdP authenticate the user, then captures session cookies via
 * a local HTTP callback server.
 *
 * Flow:
 *  1. Extension starts a local HTTP server on a random port
 *  2. Opens the SAP system URL in the user's default browser
 *  3. Browser authenticates via IdP (SAML/Kerberos/etc.)
 *  4. After successful auth, user clicks a bookmarklet or the extension
 *     helper page extracts cookies and POSTs them to localhost callback
 *  5. Extension captures MYSAPSSO2 / SAP_SESSIONID cookies
 *  6. Subsequent ADT requests use those cookies
 *
 * Cookie storage: PasswordVault (OS credential store)
 */

import * as http from "http"
import { randomBytes } from "crypto"
import { AuthResult } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"
import * as vscode from "vscode"

const VAULT_SERVICE = "vscode.abapfs.browsersso"

const SSO_COOKIE_TTL_MS = 30 * 60 * 1000 // 30 minutes — SAP session cookies typically expire in 30-60 min
const VAULT_TS_SERVICE = "vscode.abapfs.browsersso.ts"

/** Store SSO cookies securely (with timestamp). */
export async function storeSsoCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
  await vault.setPassword(VAULT_TS_SERVICE, formatKey(connId), String(Date.now()))
  log.debug(`[browser-sso] Stored ${cookies.length} cookies for ${connId}`)
}

/** Retrieve stored SSO cookies (returns empty if expired). */
export async function getSsoCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[browser-sso] No cached cookies for ${connId}`)
    return []
  }
  // Check timestamp — consider expired after TTL
  const tsRaw = await vault.getPassword(VAULT_TS_SERVICE, formatKey(connId))
  if (tsRaw) {
    const storedAt = parseInt(tsRaw, 10)
    const ageMs = Date.now() - storedAt
    if (ageMs > SSO_COOKIE_TTL_MS) {
      log.debug(`[browser-sso] Cookies expired for ${connId} (age=${Math.round(ageMs / 1000)}s, ttl=${SSO_COOKIE_TTL_MS / 1000}s)`)
      return []
    }
  }
  try {
    const parsed = JSON.parse(raw)
    const result = Array.isArray(parsed) ? parsed : []
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
 * @param timeoutMs  Max wait time (default 120 seconds)
 * @param notifyUser Optional callback to show the helper URL to the user (avoids runtime require("vscode"))
 */
export function startCookieCaptureServer(
  sapUrl: string,
  timeoutMs = 120_000,
  notifyUser?: (helperUrl: string) => void
): Promise<string[]> {
  // Random token that must be present in POST to prevent cross-origin cookie injection
  const token = randomBytes(24).toString("hex")

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Only serve the helper page at the token URL
      if (req.method === "GET" && req.url === `/${token}`) {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(getHelperPageHtml(sapUrl, token))
        return
      }

      if (req.method === "POST" && req.url === `/${token}/cookies`) {
        let body = ""
        let rejected = false
        req.on("data", (chunk: string) => {
          // Check before appending to reliably enforce the limit
          if (rejected || body.length + chunk.length > 8192) {
            if (!rejected) {
              rejected = true
              res.writeHead(413)
              res.end("Payload too large")
              req.destroy()
            }
            return
          }
          body += chunk
        })
        req.on("end", () => {
          if (rejected) return
          try {
            const data = JSON.parse(body)
            // Sanitize cookies: strip CR/LF to prevent HTTP header injection 
            const cookieString: string = data.cookies || ""
            const cookies = cookieString
              .split(";")
              .map((c: string) => c.replace(/[\r\n]/g, "").replace(/[\x00-\x1f]/g, "").trim())
              .filter((c: string) => c.includes("=") && c.length <= 4096)

            if (cookies.length === 0) {
              log.debug(`[browser-sso] POST received but no cookies extracted`)
              res.writeHead(200, { "Content-Type": "application/json" })
              res.end(JSON.stringify({ message: "No cookies received. Make sure you are logged in." }))
              return
            }

            log.debug(`[browser-sso] Captured ${cookies.length} cookies: ${cookies.map(c => c.split("=")[0]).join(",")}`)
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ message: `Captured ${cookies.length} cookies. You can close this tab.` }))

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
      const addr = server.address() as { port: number }
      const helperUrl = `http://127.0.0.1:${addr.port}/${token}`

      // Open in the user's default browser; only show notification as fallback
      import("open")
        .then(m => (m.default || m)(helperUrl))
        .then(() => {
          log.debug(`[browser-sso] Browser opened successfully for: ${helperUrl}`)
        })
        .catch((err) => {
          log.debug(`[browser-sso] Failed to open browser (${err}), showing notification fallback`)
          if (notifyUser) notifyUser(helperUrl)
        })
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error("Browser SSO timed out. No cookies received within the time limit."))
    }, timeoutMs)

    server.on("error", (err) => {
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
  sapClient: string,
): Promise<AuthResult> {
  log.debug(`[browser-sso] buildBrowserSsoAuth starting for ${connId}`)
  let cookies = await getSsoCookies(connId)
  if (cookies.length === 0) {
    log.debug(`[browser-sso] No cached cookies, starting cookie capture for ${connId}`)
    const loginUrl = `${sapUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
    cookies = await startCookieCaptureServer(loginUrl, 120_000, vscodeSsoNotify)
    await storeSsoCookies(connId, cookies)
  }

  log.debug(`[browser-sso] buildBrowserSsoAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "browser-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}

/**
 * Re-authenticate browser SSO (clear cookies and re-capture).
 */
export async function refreshBrowserSsoAuth(
  connId: string,
  sapUrl: string,
  sapClient: string,
): Promise<AuthResult> {
  log.debug(`[browser-sso] refreshBrowserSsoAuth starting for ${connId}`)
  await clearSsoCookies(connId)
  const loginUrl = `${sapUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
  const cookies = await startCookieCaptureServer(loginUrl, 120_000, vscodeSsoNotify)
  await storeSsoCookies(connId, cookies)

  log.debug(`[browser-sso] refreshBrowserSsoAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "browser-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}

/** Generate the helper HTML page for cookie capture. */
function getHelperPageHtml(sapUrl: string, token: string): string {
  // Validate URL protocol before embedding — reject javascript: or data: URIs
  if (!/^https?:\/\//i.test(sapUrl)) {
    sapUrl = "about:blank" // Safe fallback; should never reach here in normal operation
  }
  // Escape the SAP URL for safe embedding in HTML
  const escapedUrl = sapUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

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
    .success { color: #28a745; font-weight: bold; display: none; }
    .error { color: #dc3545; display: none; }
  </style>
</head>
<body>
  <h1>ABAP FS — Browser SSO Login</h1>
  <div class="step">
    <b>Step 1:</b> <a href="${escapedUrl}" target="_blank" rel="noopener">Click here to open your SAP system</a>
    and complete the SSO login in the popup window.
  </div>
  <div class="step">
    <b>Step 2:</b> After you are logged in, open browser DevTools (F12) → Application → Cookies,
    and copy all cookies for the SAP domain. Paste them below:
    <textarea id="cookieInput" placeholder="Paste cookies here (name=value; name2=value2; ...)"></textarea>
    <button onclick="submitCookies()">Submit Cookies</button>
  </div>
  <p class="success" id="success"></p>
  <p class="error" id="error"></p>
  <script>
    function submitCookies() {
      var cookies = document.getElementById('cookieInput').value.trim();
      if (!cookies) { document.getElementById('error').textContent = 'Please paste cookies first.'; document.getElementById('error').style.display = 'block'; return; }
      fetch('/${token}/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookies })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        document.getElementById('success').textContent = d.message;
        document.getElementById('success').style.display = 'block';
        document.getElementById('error').style.display = 'none';
      })
      .catch(function(e) {
        document.getElementById('error').textContent = 'Error: ' + e;
        document.getElementById('error').style.display = 'block';
      });
    }
  </script>
</body>
</html>`
}
