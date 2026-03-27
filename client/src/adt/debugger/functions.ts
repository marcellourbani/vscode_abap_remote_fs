import { ADTClient, ClientOptions, createSSLConfig } from "abap-adt-api"
import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"
import * as https from "https"
import { readFileSync, existsSync } from "fs"
import { formatKey } from "../../config"
import { configFromKey } from "../../langClient"
import { futureToken } from "../../oauth"
import { createHash } from "crypto"
import { getKerberosCookies } from "../../auth/kerberos"
import { getSsoCookies } from "../../auth/browserSso"
import { getCertPassphrase } from "../../auth/certificate"

export const md5 = (s: string) => createHash("md5").update(s).digest("hex")

function createFetchToken(conf: ClientConfiguration) {
  if (conf.oauth) return () => futureToken(formatKey(conf.name)) as Promise<string>
}

/** Get auth headers for non-basic auth methods (for debugger client). */
async function getDebuggerAuthHeaders(
  conf: ClientConfiguration
): Promise<Record<string, string> | undefined> {
  const authMethod = (conf as any).authMethod || "basic"
  const connId = formatKey(conf.name)
  switch (authMethod) {
    case "kerberos": {
      const cookies = await getKerberosCookies(connId)
      if (cookies.length > 0) return { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") }
      return undefined
    }
    case "browser_sso": {
      const cookies = await getSsoCookies(connId)
      if (cookies.length > 0) return { Cookie: cookies.map(c => c.replace(/[\r\n\x00-\x1f]/g, "")).join("; ") }
      return undefined
    }
    default:
      return undefined
  }
}

export async function newClientFromKey(key: string, options: Partial<ClientOptions> = {}) {
  const conf = await configFromKey(key)
  if (conf) {
    const sslconf: any = conf.url.match(/https:/i)
      ? { ...options, ...createSSLConfig(conf.allowSelfSigned, conf.customCA) }
      : options

    const authMethod = (conf as any).authMethod || "basic"
    let pwdOrFetch: string | (() => Promise<string>)

    if (authMethod === "cert" && !conf.oauth) {
      // Reconstruct httpsAgent from cert paths
      const certAuth = (conf as any).certAuth
      if (certAuth) {
        const allowedExts = /\.(pem|crt|cer|key|p12|pfx)$/i
        const agentOptions: https.AgentOptions = {
          rejectUnauthorized: !conf.allowSelfSigned,
          keepAlive: true,
        }
        // .p12/.pfx files are PKCS#12 containers — use `pfx` option
        if (/\.(p12|pfx)$/i.test(certAuth.certPath || "")) {
          if (certAuth.certPath && allowedExts.test(certAuth.certPath) && existsSync(certAuth.certPath))
            agentOptions.pfx = readFileSync(certAuth.certPath)
          else if (certAuth.certPath)
            throw new Error(`Client certificate (PKCS#12) not found or invalid extension: ${certAuth.certPath}`)
        } else {
          if (certAuth.certPath && allowedExts.test(certAuth.certPath) && existsSync(certAuth.certPath))
            agentOptions.cert = readFileSync(certAuth.certPath)
          else if (certAuth.certPath)
            throw new Error(`Client certificate not found or invalid extension: ${certAuth.certPath}`)
          if (certAuth.keyPath && allowedExts.test(certAuth.keyPath) && existsSync(certAuth.keyPath))
            agentOptions.key = readFileSync(certAuth.keyPath)
          else if (certAuth.keyPath)
            throw new Error(`Private key not found or invalid extension: ${certAuth.keyPath}`)
        }
        const passphrase = await getCertPassphrase(formatKey(conf.name))
        if (passphrase) agentOptions.passphrase = passphrase
        if (certAuth.caPath && allowedExts.test(certAuth.caPath) && existsSync(certAuth.caPath))
          agentOptions.ca = readFileSync(certAuth.caPath)
        sslconf.httpsAgent = new https.Agent(agentOptions)
      }
      pwdOrFetch = "cert-auth"
    } else if (authMethod === "oauth_onprem" && !conf.oauth) {
      // On-premise OAuth: use token fetcher. Wrap in try/catch to prevent
      // unexpected interactive browser login during debug sessions.
      const oauthConf = (conf as any).oauthOnPrem
      if (oauthConf) {
        try {
          const { buildOAuthOnPremAuth } = await import("../../auth/oauthOnPrem")
          const result = await buildOAuthOnPremAuth(
            formatKey(conf.name), conf.url, conf.client, oauthConf, !!conf.allowSelfSigned
          )
          pwdOrFetch = result.passwordOrFetcher
        } catch (e) {
          throw new Error(`OAuth tokens expired for ${conf.name}. Disconnect and reconnect to re-authenticate. (${e})`)
        }
      } else {
        pwdOrFetch = "oauth-onprem-auth"
      }
    } else if (authMethod !== "basic" && !conf.oauth) {
      const headers = await getDebuggerAuthHeaders(conf)
      if (headers) sslconf.headers = { ...sslconf.headers, ...headers }
      pwdOrFetch = `${authMethod}-auth`
    } else {
      pwdOrFetch = createFetchToken(conf) || conf.password
    }

    const client = new ADTClient(
      conf.url,
      conf.username,
      pwdOrFetch,
      conf.client,
      conf.language,
      sslconf
    )
    return client
  }
}
