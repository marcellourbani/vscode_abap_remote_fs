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
import { PasswordVault } from "../lib"
import { formatKey } from "../config"

const VAULT_SERVICE = "vscode.abapfs.kerberos"

/** Store captured session cookies securely. */
export async function storeKerberosCookies(connId: string, cookies: string[]): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), JSON.stringify(cookies))
}

/** Retrieve stored session cookies. */
export async function getKerberosCookies(connId: string): Promise<string[]> {
  const vault = PasswordVault.get()
  const raw = await vault.getPassword(VAULT_SERVICE, formatKey(connId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/** Clear stored session cookies. */
export async function clearKerberosCookies(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
}

/**
 * Build the PowerShell script that performs the SPNEGO handshake.
 *
 * SECURITY: The URL is passed as a PowerShell parameter ($TargetUrl) instead
 * of being interpolated directly into the script string. This prevents command
 * injection if the URL contains single-quote characters or other shell metacharacters.
 */
function buildNegotiateScript(skipSsl: boolean): string {
  const lines = [
    `param([string]$TargetUrl)`,
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    `try {`,
  ]
  if (skipSsl) {
    lines.push(
      `  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }`
    )
  }
  lines.push(
    `  $uri = [System.Uri]::new($TargetUrl)`,
    `  $req = [System.Net.HttpWebRequest]::Create($uri)`,
    `  $req.Method = 'GET'`,
    `  $req.UseDefaultCredentials = $true`,
    `  $req.PreAuthenticate = $true`,
    `  $req.AllowAutoRedirect = $false`,
    `  $req.CookieContainer = New-Object System.Net.CookieContainer`,
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
    // Also capture Set-Cookie headers directly (some SAP cookies may not parse into CookieContainer)
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
    `  $resp.Close()`,
    `  @{ status = $status; cookies = $cookies } | ConvertTo-Json -Compress`,
    `} catch {`,
    `  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress`,
    `}`
  )
  return lines.join("\n")
}

/**
 * Execute the SPNEGO handshake via PowerShell and return session cookies.
 * Timeout: 30 seconds (Kerberos should be near-instant if TGT is valid).
 *
 * SECURITY: The URL is embedded as a PowerShell single-quoted string literal
 * in the script. Single-quoted strings in PowerShell are verbatim — no
 * variable expansion or escaping occurs. The only character that needs
 * escaping is `'` itself (doubled as `''`).
 */
function runPowerShellNegotiate(
  url: string,
  skipSsl: boolean,
): Promise<{ status: number; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    // Escape single quotes for PowerShell single-quoted string literal
    const safeUrl = url.replace(/'/g, "''")
    const script = buildNegotiateScript(skipSsl)
    // Remove the param() declaration and set $TargetUrl directly as a literal
    const finalScript = script.replace(
      "param([string]$TargetUrl)",
      `$TargetUrl = '${safeUrl}'`
    )
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", finalScript],
      { timeout: 30_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Kerberos SPNEGO failed: ${error.message}${stderr ? `\n${stderr}` : ""}`))
          return
        }
        try {
          const result = JSON.parse(stdout.trim())
          if (result.error) {
            reject(new Error(`Kerberos SPNEGO failed: ${result.error}`))
            return
          }
          resolve({
            status: result.status || 0,
            cookies: result.cookies || [],
          })
        } catch {
          reject(new Error(`Failed to parse SPNEGO result: ${stdout.substring(0, 200)}`))
        }
      }
    )
    child.stdin?.end()
  })
}

/**
 * Perform Kerberos SPNEGO authentication against SAP and capture session cookies.
 * Uses Windows SSPI via PowerShell — no native modules needed.
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
      "Your machine must be domain-joined with a valid Kerberos TGT."
    )
  }

  if (!/^https?:\/\//i.test(sapBaseUrl)) {
    throw new Error("Kerberos SPNEGO requires an HTTP(S) URL")
  }

  const url = `${sapBaseUrl}/sap/bc/adt/discovery?sap-client=${encodeURIComponent(sapClient)}`
  const result = await runPowerShellNegotiate(url, skipSsl)

  if (result.cookies.length === 0) {
    if (result.status === 401) {
      throw new Error(
        "Kerberos authentication rejected by SAP (401). " +
        "Check that SPNego is enabled on the ICF service and your Kerberos TGT is valid (run 'klist' in a terminal)."
      )
    }
    throw new Error(
      `Kerberos handshake returned HTTP ${result.status} but no session cookies. ` +
      `Verify SPNego is configured on the SAP server.`
    )
  }

  return result.cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, ""))
}

/**
 * Build an AuthResult for Kerberos/SPNEGO authentication.
 *
 * Performs the SPNEGO handshake, captures cookies, stores them securely,
 * and returns an AuthResult that injects those cookies on every request.
 */
export async function buildKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean,
): Promise<AuthResult> {
  // Always re-negotiate — SPNEGO with a valid TGT is fast (<1s),
  // and reusing stale cookies risks silent 401 failures.
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  return {
    passwordOrFetcher: "kerberos-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}

/**
 * Re-authenticate Kerberos (clear cached cookies and redo SPNEGO handshake).
 */
export async function refreshKerberosAuth(
  connId: string,
  kerberosConfig: KerberosAuthConfig | undefined,
  sapBaseUrl: string,
  sapClient: string,
  skipSsl: boolean,
): Promise<AuthResult> {
  await clearKerberosCookies(connId)
  const cookies = await negotiateWithSap(kerberosConfig, sapBaseUrl, sapClient, skipSsl)
  await storeKerberosCookies(connId, cookies)

  return {
    passwordOrFetcher: "kerberos-sso",
    headers: { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") },
  }
}
