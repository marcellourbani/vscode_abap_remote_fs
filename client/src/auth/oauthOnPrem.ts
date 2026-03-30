/**
 * On-Premise SAP OAuth 2.0 Authentication (Authorization Code + PKCE)
 *
 * Uses SAP's built-in OAuth 2.0 provider configured via transaction SOAUTH2.
 * The SAP system itself is the OAuth server — no external IdP URL needed.
 *
 * Endpoints:
 *   Authorize: {sapUrl}/sap/bc/sec/oauth2/authorize
 *   Token:     {sapUrl}/sap/bc/sec/oauth2/token
 *
 * Flow:
 *  1. Generate PKCE code verifier + SHA-256 challenge
 *  2. Open browser to SAP authorization endpoint
 *  3. User authenticates (SAP login or SSO via IdP)
 *  4. SAP redirects to localhost callback with authorization code
 *  5. Exchange code for access + refresh tokens
 *  6. Bearer token used for all ADT requests
 *  7. Auto-refresh via refresh token before expiry
 *
 * Prerequisites:
 *  - SOAUTH2 configured on SAP system
 *  - OAuth client registered with redirect URI: http://localhost:{port}/callback
 *  - Scope includes ADT access (typically "SAP_ADT")
 */

import * as http from "http"
import * as https from "https"
import { randomBytes, createHash } from "crypto"
import * as vscode from "vscode"
import { AuthResult } from "./types"
import { OAuthOnPremConfig } from "vscode-abap-remote-fs-sharedapi"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"

const VAULT_SERVICE = "vscode.abapfs.oauth_onprem"

interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
}

/** Store tokens securely in the OS credential manager. */
async function storeTokens(connId: string, tokens: TokenSet): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(tokens))
  log.debug(`[oauth-onprem] Stored tokens for ${connId}, expiresAt=${new Date(tokens.expiresAt).toISOString()}`)
}

/** Retrieve stored tokens. */
async function getTokens(connId: string): Promise<TokenSet | null> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[oauth-onprem] No cached tokens for ${connId}`)
    return null
  }
  try {
    const tokens = JSON.parse(raw) as TokenSet
    const remainingMs = tokens.expiresAt - Date.now()
    log.debug(`[oauth-onprem] Retrieved cached tokens for ${connId}, expires in ${Math.round(remainingMs / 1000)}s`)
    return tokens
  } catch (e) {
    log.debug(`[oauth-onprem] Failed to parse cached tokens for ${connId}: ${e}`)
    return null
  }
}

/** Clear stored tokens. */
export async function clearOAuthOnPremTokens(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  log.debug(`[oauth-onprem] Cleared tokens for ${connId}`)
}

/**
 * Perform the full OAuth Authorization Code + PKCE flow.
 *
 * Opens the user's browser to SAP's authorization endpoint,
 * listens on a local HTTP server for the redirect callback,
 * exchanges the code for tokens, and returns them.
 */
async function authorizeInteractive(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean,
): Promise<TokenSet> {
  // PKCE: generate code verifier and challenge
  const codeVerifier = randomBytes(32).toString("base64url")
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  const state = randomBytes(16).toString("hex")

  return new Promise((resolve, reject) => {
    const cspHeader = "Content-Security-Policy"
    const cspValue = "default-src 'none'"

    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback?") && req.url !== "/callback") {
        res.writeHead(404)
        res.end("Not found")
        return
      }

      const url = new URL(req.url, `http://localhost`)
      const code = url.searchParams.get("code")
      const receivedState = url.searchParams.get("state")
      const error = url.searchParams.get("error")

      if (error) {
        log.debug(`[oauth-onprem] SAP returned OAuth error: ${error} — ${url.searchParams.get("error_description") || ""}`)
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end("<html><body><h2>Authentication Failed</h2><p>SAP returned an error. You can close this tab.</p></body></html>")
        clearTimeout(timer)
        server.close()
        reject(new Error(`OAuth error from SAP: ${error} — ${url.searchParams.get("error_description") || ""}`))
        return
      }

      if (!code || receivedState !== state) {
        log.debug(`[oauth-onprem] State mismatch or missing code: receivedState=${receivedState}, expectedState=${state}, hasCode=${!!code}`)
        res.writeHead(400, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end("<html><body><h2>Invalid Response</h2><p>Missing authorization code or state mismatch.</p></body></html>")
        clearTimeout(timer)
        server.close()
        reject(new Error("OAuth state mismatch — possible CSRF attack"))
        return
      }

      // Exchange code for tokens
      try {
        const addr = server.address() as { port: number }
        const tokens = await exchangeCodeForTokens(
          sapUrl, sapClient, config, code, codeVerifier, addr.port, skipSsl
        )
        log.debug(`[oauth-onprem] Token exchange successful, accessToken length=${tokens.accessToken.length}`)
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end("<html><body><h2>Authentication Successful</h2><p>You can close this tab and return to VS Code.</p></body></html>")
        clearTimeout(timer)
        server.close()
        resolve(tokens)
      } catch (err: any) {
        log.debug(`[oauth-onprem] Token exchange failed: ${err.message}`)
        res.writeHead(200, { "Content-Type": "text/html", [cspHeader]: cspValue })
        res.end(`<html><body><h2>Token Exchange Failed</h2><p>${escapeHtml(err.message)}</p></body></html>`)
        clearTimeout(timer)
        server.close()
        reject(err)
      }
    })

    // Listen on a random port on loopback
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      const redirectUri = `http://localhost:${addr.port}/callback`

      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: config.scope || "SAP_ADT",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        "sap-client": sapClient,
      })

      const authUrl = `${sapUrl}/sap/bc/sec/oauth2/authorize?${params.toString()}`

      // Open in the user's default browser
      vscode.env.openExternal(vscode.Uri.parse(authUrl))
      vscode.window.showInformationMessage(
        "OAuth: Complete the login in your browser. Waiting for redirect...",
      )
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error("OAuth login timed out (120 seconds). No authorization code received."))
    }, 120_000)

    server.on("error", (err) => {
      clearTimeout(timer)
      reject(new Error(`OAuth callback server error: ${err.message}`))
    })
  })
}

/**
 * Exchange authorization code for access + refresh tokens.
 */
async function exchangeCodeForTokens(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  code: string,
  codeVerifier: string,
  callbackPort: number,
  skipSsl: boolean,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `http://localhost:${callbackPort}/callback`,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  })

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret)
  }

  const tokenUrl = `${sapUrl}/sap/bc/sec/oauth2/token?sap-client=${encodeURIComponent(sapClient)}`
  const resp = await doPost(tokenUrl, body.toString(), skipSsl)

  if (!resp.ok) {
    throw new Error(`Token exchange failed: HTTP ${resp.status} — ${resp.body.substring(0, 200)}`)
  }

  const data = JSON.parse(resp.body)
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new Error(`Token response missing access_token: ${resp.body.substring(0, 200)}`)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshTokens(
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  refreshToken: string,
  skipSsl: boolean,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  })

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret)
  }

  const tokenUrl = `${sapUrl}/sap/bc/sec/oauth2/token?sap-client=${encodeURIComponent(sapClient)}`
  log.debug(`[oauth-onprem] Refreshing tokens at: ${tokenUrl}`)
  const resp = await doPost(tokenUrl, body.toString(), skipSsl)

  if (!resp.ok) {
    log.debug(`[oauth-onprem] Token refresh HTTP error: ${resp.status}`)
    throw new Error(`Token refresh failed: HTTP ${resp.status}`)
  }

  const data = JSON.parse(resp.body)
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new Error(`Token refresh response missing access_token: ${resp.body.substring(0, 200)}`)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  }
}

/**
 * Build an AuthResult for on-premise OAuth.
 *
 * Tries stored tokens first (with refresh if expired),
 * falls back to interactive browser login.
 */
export async function buildOAuthOnPremAuth(
  connId: string,
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean,
): Promise<AuthResult> {
  log.debug(`[oauth-onprem] buildOAuthOnPremAuth starting for ${connId}, clientId=${config.clientId}`)
  // Resolve client secret from vault if not inline
  if (!config.clientSecret) {
    const vault = PasswordVault.get()
    const secret = await vault.getPassword("vscode.abapfs.oauth_onprem_secret", formatKey(connId))
    if (secret) config = { ...config, clientSecret: secret }
  }

  let tokens = await getTokens(connId)

  if (tokens) {
    // Check if access token is expired (with 60s buffer)
    if (tokens.expiresAt < Date.now() + 60_000) {
      // Try refresh
      if (tokens.refreshToken) {
        try {
          log.debug(`[oauth-onprem] Token expired, attempting refresh for ${connId}`)
          tokens = await refreshTokens(sapUrl, sapClient, config, tokens.refreshToken, skipSsl)
          await storeTokens(connId, tokens)
        } catch (e) {
          log.debug(`[oauth-onprem] Token refresh failed for ${connId}, will do interactive login: ${e}`)
          tokens = null
        }
      } else {
        log.debug(`[oauth-onprem] Token expired and no refresh token for ${connId}`)
        tokens = null
      }
    }
  }

  if (!tokens) {
    log.debug(`[oauth-onprem] No valid tokens, starting interactive login for ${connId}`)
    tokens = await authorizeInteractive(sapUrl, sapClient, config, skipSsl)
    await storeTokens(connId, tokens)
  }

  // Return a token fetcher that auto-refreshes
  const fetchToken = createTokenFetcher(connId, sapUrl, sapClient, config, skipSsl)

  log.debug(`[oauth-onprem] buildOAuthOnPremAuth complete for ${connId}`)
  return {
    passwordOrFetcher: fetchToken,
  }
}

/**
 * Create a token fetcher function that ADTClient calls on every request.
 * Handles automatic refresh when the token is near expiry.
 * Uses a per-connection mutex to prevent concurrent refresh races.
 */
const refreshLocks = new Map<string, Promise<TokenSet>>()

function createTokenFetcher(
  connId: string,
  sapUrl: string,
  sapClient: string,
  config: OAuthOnPremConfig,
  skipSsl: boolean,
): () => Promise<string> {
  return async () => {
    let tokens = await getTokens(connId)
    if (!tokens) throw new Error("OAuth tokens not available — reconnect required")

    // Refresh if expired (60s buffer)
    if (tokens.expiresAt < Date.now() + 60_000 && tokens.refreshToken) {
      log.debug(`[oauth-onprem] Token near expiry in fetcher, refreshing for ${connId}`)
      // Mutex: only one refresh at a time per connection
      let pending = refreshLocks.get(connId)
      if (!pending) {
        pending = refreshTokens(sapUrl, sapClient, config, tokens.refreshToken, skipSsl)
          .then(async (newTokens) => {
            await storeTokens(connId, newTokens)
            return newTokens
          })
          .finally(() => refreshLocks.delete(connId))
        refreshLocks.set(connId, pending)
      }
      try {
        tokens = await pending
      } catch (e) {
        log.debug(`[oauth-onprem] Token refresh failed in fetcher for ${connId}: ${e}`)
        throw new Error("OAuth token refresh failed — reconnect required")
      }
    }

    return tokens.accessToken
  }
}

/** Simple HTTPS POST helper using Node.js built-in https module. Rejects non-HTTPS URLs. */
function doPost(
  url: string,
  body: string,
  skipSsl: boolean,
): Promise<{ ok: boolean; status: number; body: string }> {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") {
    return Promise.reject(new Error(
      "OAuth token exchange requires HTTPS. Refusing to send credentials over plaintext HTTP."
    ))
  }

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search || ""}`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
      rejectUnauthorized: !skipSsl,
      timeout: 30_000,
    }

    const req = https.request(options, (res) => {
      let data = ""
      const maxSize = 1024 * 1024 // 1 MB response limit
      res.on("data", (chunk: string) => {
        data += chunk
        if (data.length > maxSize) {
          req.destroy()
          reject(new Error("OAuth token response too large (>1MB)"))
        }
      })
      res.on("end", () => {
        resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: data })
      })
    })
    req.on("timeout", () => { req.destroy(new Error("OAuth token request timed out (30s)")) })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
