/**
 * Kerberos / SPNEGO Authentication
 *
 * Uses the OS-native credential stack to authenticate to SAP systems
 * with Kerberos/SPNEGO (e.g. SAP Secure Login Client on Windows).
 *
 * On Windows: invokes PowerShell with .NET HttpWebRequest +
 *   UseDefaultCredentials, which uses Windows SSPI automatically.
 *   Zero native modules required — no `kerberos` npm package.
 *
 * Flow:
 *  1. Windows domain user has a Kerberos TGT (domain login or SAP Secure Login Client)
 *  2. PowerShell makes an HTTP request to SAP with UseDefaultCredentials=true
 *  3. .NET/SSPI handles the full SPNEGO Negotiate handshake transparently
 *  4. We capture the session cookies (MYSAPSSO2, SAP_SESSIONID_*) from the response
 *  5. Subsequent ADT requests use those cookies via custom headers
 *
 * Prerequisites:
 *  - Windows domain-joined machine with valid Kerberos TGT
 *  - SAP ICF service configured for SPNego authentication
 */

import { execFile } from "child_process"
import { AuthResult, KerberosAuthConfig } from "./types"
import { PasswordVault, log } from "../lib"
import { formatKey } from "../config"

const VAULT_SERVICE = "vscode.abapfs.kerberos"

/** SAP session cookie name patterns that indicate successful authentication. */
const SAP_AUTH_COOKIE_PATTERNS = [
  /^MYSAPSSO2$/i,
  /^SAP_SESSIONID_/i,
  /^sap-XCSRF/i,
  /^SAP_CLIENTID/i,
]

function isAuthCookie(name: string): boolean {
  return SAP_AUTH_COOKIE_PATTERNS.some(p => p.test(name))
}

/** Store captured session cookies securely. */
export async function storeKerberosCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
  log.debug(`[kerberos] Stored ${cookies.length} cookies for ${connId}`)
}

/** Retrieve stored session cookies. */
export async function getKerberosCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) {
    log.debug(`[kerberos] No cached cookies for ${connId}`)
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    const result = Array.isArray(parsed) ? parsed : []
    log.debug(`[kerberos] Retrieved ${result.length} cached cookies for ${connId}`)
    return result
  } catch (e) {
    log.debug(`[kerberos] Failed to parse cached cookies for ${connId}: ${e}`)
    return []
  }
}

/** Clear stored session cookies. */
export async function clearKerberosCookies(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
  log.debug(`[kerberos] Cleared cached cookies for ${connId}`)
}

/**
 * Build the PowerShell script that performs Windows SSO authentication.
 *
 * Strategy (two-phase fallback):
 *  Phase 1: Try UseDefaultCredentials (NTLM/Kerberos/SPNEGO)
 *           Works for domain-joined machines with a valid Kerberos TGT.
 *  Phase 2: If Phase 1 returns 401, scan the Windows certificate store
 *           (CurrentUser\My) for client authentication certificates and
 *           retry with client certificate auth.
 *           Works for SAP Secure Login Client (SLC) which installs X.509
 *           certificates into the Windows cert store.
 *
 * Output: JSON with { method, status, cookies, authHeader, certSubject?, error? }
 */
function buildNegotiateScript(skipSsl: boolean): string {
  const lines: string[] = []
  lines.push(
    `param([string]$TargetUrl)`,
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    ``,
    `function DoRequest($uri, $useDefaultCreds, $cert) {`,
    `  $req = [System.Net.HttpWebRequest]::Create($uri)`,
    `  $req.Method = 'GET'`,
    `  $req.AllowAutoRedirect = $false`,
    `  $req.CookieContainer = New-Object System.Net.CookieContainer`,
  )
  if (skipSsl) {
    lines.push(
      `  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }`,
    )
  }
  lines.push(
    `  if ($useDefaultCreds) {`,
    `    $req.UseDefaultCredentials = $true`,
    `    $req.PreAuthenticate = $true`,
    `  }`,
    `  if ($cert) {`,
    `    $req.ClientCertificates.Add($cert) | Out-Null`,
    `  }`,
    `  $resp = $null`,
    `  try { $resp = $req.GetResponse() } catch [System.Net.WebException] {`,
    `    if ($_.Exception.Response) { $resp = $_.Exception.Response }`,
    `    else { throw }`,
    `  }`,
    `  $status = [int]$resp.StatusCode`,
    `  $cookies = @()`,
    `  foreach ($c in $resp.Cookies) {`,
    `    $cookies += "$($c.Name)=$($c.Value)"`,
    `  }`,
    `  $setCookieHeader = $resp.Headers['Set-Cookie']`,
    `  if ($setCookieHeader) {`,
    `    foreach ($part in $setCookieHeader -split ',(?=[^ ])') {`,
    `      $kv = ($part.Trim() -split ';')[0].Trim()`,
    `      if ($kv -match '=') {`,
    `        $name = ($kv -split '=')[0]`,
    `        $found = $false`,
    `        foreach ($existing in $cookies) { if ($existing.StartsWith("$name=")) { $found = $true } }`,
    `        if (-not $found) { $cookies += $kv }`,
    `      }`,
    `    }`,
    `  }`,
    `  $authHeader = $resp.Headers['WWW-Authenticate']`,
    `  $resp.Close()`,
    `  return @{ status = $status; cookies = $cookies; authHeader = $authHeader }`,
    `}`,
    ``,
    `try {`,
    `  $uri = [System.Uri]::new($TargetUrl)`,
    ``,
    `  # ── Phase 1: Kerberos/NTLM via UseDefaultCredentials ──`,
    `  $r1 = DoRequest $uri $true $null`,
    `  if ($r1.status -ge 200 -and $r1.status -lt 400) {`,
    `    @{ method = 'kerberos'; status = $r1.status; cookies = $r1.cookies; authHeader = $r1.authHeader } | ConvertTo-Json -Compress`,
    `    exit`,
    `  }`,
    ``,
    `  # Phase 1 failed — log it`,
    `  $phase1Status = $r1.status`,
    `  $phase1Auth = $r1.authHeader`,
    ``,
    `  # ── Phase 2: Client certificate from Windows cert store (SLC) ──`,
    `  $certs = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object {`,
    `    $_.HasPrivateKey -and`,
    `    $_.NotAfter -gt (Get-Date) -and`,
    `    ($_.EnhancedKeyUsageList.Count -eq 0 -or ($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.2' }))`,
    `  } | Sort-Object NotAfter -Descending`,
    ``,
    `  $certCount = @($certs).Count`,
    `  $triedCerts = @()`,
    ``,
    `  foreach ($cert in $certs) {`,
    `    $subj = $cert.Subject`,
    `    $thumb = $cert.Thumbprint`,
    `    $triedCerts += "$subj ($thumb)"`,
    `    try {`,
    `      $r2 = DoRequest $uri $false $cert`,
    `      if ($r2.status -ge 200 -and $r2.status -lt 400) {`,
    `        @{ method = 'certificate'; status = $r2.status; cookies = $r2.cookies; authHeader = $r2.authHeader; certSubject = $subj } | ConvertTo-Json -Compress`,
    `        exit`,
    `      }`,
    `    } catch {`,
    `      # This cert didn't work, try next`,
    `    }`,
    `  }`,
    ``,
    `  # Both phases failed`,
    `  @{`,
    `    error = "All SSO methods failed"`,
    `    phase1Status = $phase1Status`,
    `    phase1Auth = $phase1Auth`,
    `    certsFound = $certCount`,
    `    certsTried = $triedCerts`,
    `  } | ConvertTo-Json -Compress`,
    `} catch {`,
    `  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress`,
    `}`,
  )
  return lines.join("\n")
}

interface NegotiateResult {
  method: string       // "kerberos" or "certificate"
  status: number
  cookies: string[]
  authHeader?: string
  certSubject?: string // which cert worked (for certificate method)
}

/**
 * Execute Windows SSO via PowerShell and return session cookies.
 * Timeout: 30 seconds.
 *
 * SECURITY: The URL is embedded as a PowerShell single-quoted string literal.
 * Single-quoted strings in PowerShell are verbatim — no variable expansion
 * or escaping occurs. The only char that needs escaping is ' (doubled as '').
 */
function runPowerShellNegotiate(
  url: string,
  skipSsl: boolean,
): Promise<NegotiateResult> {
  return new Promise((resolve, reject) => {
    const safeUrl = url.replace(/'/g, "''")
    const script = buildNegotiateScript(skipSsl)
    const finalScript = script.replace(
      "param([string]$TargetUrl)",
      `$TargetUrl = '${safeUrl}'`
    )
    log.debug(`[sso] Launching PowerShell SSO handshake for: ${url}`)
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", finalScript],
      { timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          log.debug(`[sso] PowerShell process error: ${error.message}`)
          if (stderr) log.debug(`[sso] PowerShell stderr: ${stderr.substring(0, 500)}`)
          reject(new Error(`Windows SSO failed: ${error.message}${stderr ? `\n${stderr}` : ""}`))
          return
        }
        if (stderr) log.debug(`[sso] PowerShell stderr: ${stderr.substring(0, 300)}`)
        log.debug(`[sso] PowerShell raw output: ${stdout.substring(0, 600)}`)
        try {
          const result = JSON.parse(stdout.trim())
          if (result.error && result.error !== "All SSO methods failed") {
            log.debug(`[sso] Script error: ${result.error}`)
            reject(new Error(`Windows SSO failed: ${result.error}`))
            return
          }
          if (result.error === "All SSO methods failed") {
            // Structured failure — build a descriptive error
            const p1 = `Phase 1 (Kerberos/NTLM): HTTP ${result.phase1Status}, WWW-Authenticate: ${result.phase1Auth || "absent"}`
            const p2 = `Phase 2 (Certificate): found ${result.certsFound || 0} certs in Windows store`
            const tried = (result.certsTried || []).join(", ") || "none"
            log.debug(`[sso] Both phases failed. ${p1}. ${p2}. Tried: ${tried}`)
            reject(new Error(
              `Windows SSO authentication failed.\n` +
              `  ${p1}\n` +
              `  ${p2}\n` +
              `  Certificates tried: ${tried}\n\n` +
              `Possible causes:\n` +
              `  • No valid Kerberos TGT (for SPNEGO)\n` +
              `  • SAP Secure Login Client not running or not logged in (for certificate SSO)\n` +
              `  • Certificate not mapped to a SAP user (check CERTRULE/STRUST in SAP)\n` +
              `  • SPNego or certificate auth not enabled on the SAP ICF service`
            ))
            return
          }
          log.debug(`[sso] Success via ${result.method}: HTTP ${result.status}, cookies=${(result.cookies || []).length}${result.certSubject ? `, cert=${result.certSubject}` : ""}`)
          resolve({
            method: result.method || "unknown",
            status: result.status || 0,
            cookies: result.cookies || [],
            authHeader: result.authHeader || undefined,
            certSubject: result.certSubject || undefined,
          })
        } catch (e) {
          log.debug(`[sso] Failed to parse PowerShell output: ${e}`)
          reject(new Error(`Failed to parse SSO result: ${stdout.substring(0, 200)}`))
        }
      }
    )
    child.stdin?.end()
  })
}

/** SAP tracking cookies sent even on auth failure — must be excluded. */
const SAP_TRACKING_COOKIES = [
  /^sap-usercontext$/i,
  /^sap-contextid$/i,
]

function isTrackingCookie(name: string): boolean {
  return SAP_TRACKING_COOKIES.some(p => p.test(name))
}

/**
 * Perform Windows SSO authentication against SAP and capture session cookies.
 * Tries Kerberos/NTLM first, then falls back to Windows cert store (SLC).
 */
async function negotiateWithSap(
  _config: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean,
): Promise<string[]> {
  if (process.platform !== "win32") {
    throw new Error(
      "Kerberos/SPNEGO authentication is currently supported on Windows only. " +
      "Your machine must be domain-joined with a valid Kerberos TGT, or have SAP Secure Login Client running."
    )
  }

  if (!/^https?:\/\//i.test(sapBaseUrl)) {
    throw new Error("Windows SSO requires an HTTP(S) URL")
  }

  const url = `${sapBaseUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
  log.debug(`[sso] Starting Windows SSO negotiation with: ${url}`)
  const result = await runPowerShellNegotiate(url, skipSsl)

  // Filter out SAP tracking cookies (sap-usercontext etc.) — these are sent on ALL
  // responses including 401 failures and do NOT indicate successful authentication.
  const allCookies = result.cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, ""))
  const sessionCookies = allCookies.filter(c => !isTrackingCookie(c.split("=")[0]))

  log.debug(`[sso] Cookies: total=${allCookies.length}, session=${sessionCookies.length} (${sessionCookies.map(c => c.split("=")[0]).join(",")})`)

  if (sessionCookies.length === 0) {
    // runPowerShellNegotiate already throws on auth failure, but guard just in case
    throw new Error(
      `SSO handshake returned HTTP ${result.status} but no session cookies. ` +
      `Tracking cookies were filtered. Raw cookies: ${allCookies.map(c => c.split("=")[0]).join(", ")}`
    )
  }

  if (result.method === "certificate") {
    log.debug(`[sso] Authenticated via SLC certificate: ${result.certSubject}`)
  } else {
    log.debug(`[sso] Authenticated via Kerberos/NTLM`)
  }

  return sessionCookies
}

/**
 * Build an AuthResult for Kerberos/SPNEGO/SLC authentication.
 *
 * Performs the SSO handshake, captures cookies, stores them securely,
 * and returns an AuthResult that injects those cookies on every request.
 */
export async function buildKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean,
): Promise<AuthResult> {
  log.debug(`[sso] buildKerberosAuth starting for ${connId}`)
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  log.debug(`[sso] buildKerberosAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "kerberos-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}

/**
 * Re-authenticate (clear cached cookies and redo SSO handshake).
 */
export async function refreshKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean,
): Promise<AuthResult> {
  log.debug(`[sso] refreshKerberosAuth starting for ${connId}`)
  await clearKerberosCookies(connId)
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  log.debug(`[sso] refreshKerberosAuth complete for ${connId}: ${cookies.length} cookies`)
  return {
    passwordOrFetcher: "kerberos-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}
