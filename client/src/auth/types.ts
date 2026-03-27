/**
 * Authentication types and interfaces for SAP system connections.
 *
 * Supported methods:
 *  - basic:       Username + password (default)
 *  - cert:        X.509 client certificate (mutual TLS)
 *  - kerberos:    Kerberos/SPNEGO via Windows SSPI
 *  - browser_sso: Interactive browser login → cookie capture
 *
 * OAuth (Cloud Foundry) is handled separately via the existing oauth/ module.
 *
 * AuthMethod, CertAuthConfig, KerberosAuthConfig are defined in sharedapi
 * so the language server can also reference them.
 */

// Re-export canonical types from sharedapi rather than duplicating them
export type { AuthMethod, CertAuthConfig, KerberosAuthConfig } from "vscode-abap-remote-fs-sharedapi"

export const AUTH_METHODS = ["basic", "cert", "kerberos", "browser_sso", "oauth_onprem"] as const

export const AUTH_METHOD_LABELS: Record<string, string> = {
  basic: "Basic (Username/Password)",
  cert: "X.509 Client Certificate",
  kerberos: "Kerberos / SPNEGO (SSO)",
  browser_sso: "Browser SSO (Cookie Capture)",
  oauth_onprem: "OAuth 2.0 (On-Premise SAP)",
}

/** Result of an authentication attempt — provides what ADTClient needs. */
export interface AuthResult {
  /** Password string or async token fetcher for ADTClient constructor. */
  passwordOrFetcher: string | (() => Promise<string>)
  /** Custom HTTPS agent (for certificate auth). */
  httpsAgent?: import("https").Agent
  /** Extra headers to inject on every request (e.g. cookies). */
  headers?: Record<string, string>
}
