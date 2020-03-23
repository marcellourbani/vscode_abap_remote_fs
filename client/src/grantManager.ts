import { Token } from "client-oauth2"
import { RemoteConfig, formatKey } from "./config"
import { context } from "./extension"

export interface TokenData {
  tokenType: string
  accessToken: string
  refreshToken: string
}

const KEY = "oauth_grants"
const tokens = new Map<string, TokenData>()

const strip = (t: TokenData) => {
  const { accessToken, refreshToken, tokenType } = t
  return { accessToken, refreshToken, tokenType }
}

export function getToken(conf: RemoteConfig) {
  const connId = formatKey(conf.name)
  return tokens.get(connId)
}

export function setToken(conf: RemoteConfig, token: TokenData) {
  tokens.set(formatKey(conf.name), strip(token))
}

export function storeTokens() {
  const t = [...tokens.entries()]
  return context.globalState.update(KEY, t)
}

export function clearTokens() {
  context.globalState.update(KEY, undefined)
}

export function loadTokens() {
  const entries: [string, Token][] = context.globalState.get(KEY, [])
  entries.forEach(e => tokens.set(...e))
}
