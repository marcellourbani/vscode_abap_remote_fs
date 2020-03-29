import { Token } from "client-oauth2"
import { context } from "../extension"

export interface TokenData {
  tokenType: string
  accessToken: string
  refreshToken: string
}

const KEY = "oauth_grants"
const tokens = new Map<string, TokenData>()

export const strip = (t: TokenData): TokenData => {
  const { accessToken, refreshToken, tokenType } = t
  return { accessToken, refreshToken, tokenType }
}

export function getToken(connId: string) {
  return tokens.get(connId)
}

export function setToken(connId: string, token: TokenData) {
  tokens.set(connId, strip(token))
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
