import ClientOAuth2, { Token } from "client-oauth2"
import { getToken, setToken, TokenData, strip } from "./grantStorage"
import { RemoteConfig, formatKey, RemoteManager } from "../config"
import { loginServer, cfCodeGrant } from "abap_cloud_platform"
import { after, cache } from "../lib"
import { some, none, toUndefined } from "fp-ts/lib/Option"

const pendingGrants = new Map<string, Promise<Token>>()
export const futureToken = async (connId: string) => {
  const oldGrant = getToken(connId)
  if (oldGrant) return oldGrant.accessToken
  const pending = pendingGrants.get(connId)
  if (pending) return pending.then(t => t.accessToken)
}

const deserializeToken = (s?: string): TokenData | undefined => {
  const data = s && JSON.parse(s)
  const { accessToken, refreshToken, tokenType } = data || {}
  if (accessToken && refreshToken && tokenType) return strip(data)
}
const serializeToken = (data: TokenData) => JSON.stringify(data)

const toVault = async (conf: RemoteConfig, token: Token) => {
  const serialized = serializeToken(strip(token))
  const { clientId, clientSecret, loginUrl } = conf.oauth || {}
  if (!(clientId && clientSecret && loginUrl)) return
  RemoteManager.get().savePassword(conf.name, clientId, serialized)
}

const fromVault = async (conf: RemoteConfig) => {
  const { clientId, clientSecret, loginUrl } = conf.oauth || {}
  if (!(clientId && clientSecret && loginUrl)) return none
  try {
    const tp = await RemoteManager.get().getPassword(conf.name, clientId)
    const td = tp && deserializeToken(tp)
    if (!td) return none
    const oauth = new ClientOAuth2({
      authorizationUri: `${loginUrl}/oauth/authorize`,
      accessTokenUri: `${loginUrl}/oauth/token`,
      redirectUri: "http://localhost/notfound",
      clientId,
      clientSecret
    })
    const token = await oauth
      .createToken(td.accessToken, td.refreshToken, td.tokenType, {})
      .refresh()
    return some(strip(token))
  } catch (error) {
    return none
  }
}

export function oauthLogin(conf: RemoteConfig) {
  if (!conf.oauth) return
  const { clientId, clientSecret, loginUrl, saveCredentials } = conf.oauth
  return async () => {
    const connId = formatKey(conf.name)
    let oldGrant = getToken(connId)
    if (saveCredentials && !oldGrant)
      oldGrant = toUndefined(await fromVault(conf))
    if (oldGrant) {
      setToken(connId, oldGrant)
      return oldGrant.accessToken
    }

    const server = loginServer()
    const grant = cfCodeGrant(loginUrl, clientId, clientSecret, server)
    const timeout = after(60000).then(() => {
      server.server.close()
      throw new Error("User logon timed out")
    })
    const pendingGrant = Promise.race([grant, timeout])
    pendingGrants.set(formatKey(connId), pendingGrant)
    const result = await pendingGrant
    if (result) setToken(connId, result)
    pendingGrants.delete(formatKey(connId))
    if (saveCredentials) toVault(conf, result)
    return result.accessToken
  }
}
const logins = cache(oauthLogin)
