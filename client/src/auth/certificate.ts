/**
 * X.509 Client Certificate Authentication
 *
 * Builds an https.Agent with the user's client certificate + private key.
 * SAP authenticates the user by mapping the certificate to a SAP user
 * (via CERTRULE / STRUST configuration on the SAP side).
 *
 * What's stored where:
 *  - certPath, keyPath, caPath → VS Code settings (non-secret paths)
 *  - passphrase → PasswordVault (OS credential store)
 *
 * The ADTClient receives a dummy username placeholder; actual auth
 * happens at the TLS layer via the custom httpsAgent.
 */

import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { AuthResult, CertAuthConfig } from "./types"
import { PasswordVault } from "../lib"
import { formatKey } from "../config"

const VAULT_SERVICE = "vscode.abapfs.cert"

/** Store cert passphrase securely. */
export async function storeCertPassphrase(connId: string, passphrase: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.setPassword(VAULT_SERVICE, formatKey(connId), passphrase)
}

/** Retrieve cert passphrase from secure storage. */
export async function getCertPassphrase(connId: string): Promise<string> {
  const vault = PasswordVault.get()
  return (await vault.getPassword(VAULT_SERVICE, formatKey(connId))) || ""
}

/** Clear cert passphrase from secure storage. */
export async function clearCertPassphrase(connId: string): Promise<void> {
  const vault = PasswordVault.get()
  await vault.deletePassword(VAULT_SERVICE, formatKey(connId))
}

/**
 * Build an AuthResult for certificate authentication.
 *
 * @param connId      Connection identifier (for vault lookup)
 * @param certConfig  Certificate paths from settings
 * @param skipSsl     Whether to skip server cert validation
 * @param customCA    Optional custom CA cert content or path
 */
export async function buildCertAuth(
  connId: string,
  certConfig: CertAuthConfig,
  skipSsl: boolean,
  customCA?: string
): Promise<AuthResult> {
  const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
  const isPkcs12 = /\.(p12|pfx)$/i.test(certConfig.certPath || "")
  if (!certConfig.certPath || !allowedExts.test(certConfig.certPath) || !existsSync(certConfig.certPath)) {
    throw new Error(`Client certificate not found or invalid extension: ${certConfig.certPath}`)
  }
  // keyPath is only required for PEM format, not for PKCS#12 (.p12/.pfx) containers
  if (!isPkcs12) {
    if (!certConfig.keyPath || !allowedExts.test(certConfig.keyPath) || !existsSync(certConfig.keyPath)) {
      throw new Error(`Private key not found or invalid extension: ${certConfig.keyPath}`)
    }
  }

  const agentOptions: https.AgentOptions = {
    rejectUnauthorized: !skipSsl,
    keepAlive: true,
  }

  // .p12/.pfx files are PKCS#12 containers — use `pfx` option, not cert+key
  if (/\.(p12|pfx)$/i.test(certConfig.certPath)) {
    agentOptions.pfx = readFileSync(certConfig.certPath)
    // keyPath is not used for PFX containers
  } else {
    agentOptions.cert = readFileSync(certConfig.certPath)
    agentOptions.key = readFileSync(certConfig.keyPath)
  }

  const passphrase = await getCertPassphrase(connId)
  if (passphrase) {
    agentOptions.passphrase = passphrase
  }

  // CA chain: prefer explicit caPath from cert config, then connection-level customCA
  const caPath = certConfig.caPath || customCA
  if (caPath) {
    if (existsSync(caPath)) {
      agentOptions.ca = readFileSync(caPath)
    } else if (caPath.includes("-----BEGIN CERTIFICATE-----")) {
      agentOptions.ca = caPath // Already PEM content
    } else {
      throw new Error(`CA certificate not found: ${caPath}`)
    }
  }

  const agent = new https.Agent(agentOptions)

  // ADTClient still requires a username/password. For cert auth the server
  // authenticates via TLS so we pass a dummy password. The username from
  // the connection config is used for display/logging only.
  return {
    passwordOrFetcher: "x509-cert-auth",
    httpsAgent: agent,
  }
}
