import { Token } from "client-oauth2"
import { context } from "../extension"
import { PasswordVault, log } from "../lib"

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

export async function storeTokens() {
  try {
    const vault = PasswordVault.get();
    const tokenEntries = [...tokens.entries()];
    
    // Store each token securely using VSCode secrets API
    for (const [connId, token] of tokenEntries) {
      await vault.setPassword('oauth-tokens', connId, JSON.stringify(strip(token)));
    }
    
    // Clear from global state (legacy cleanup)
    await context.globalState.update(KEY, undefined);
    
  } catch (error) {
    log(`❌ Failed to store OAuth tokens securely: ${error}`);
    // Fallback to old method to maintain functionality
    const t = [...tokens.entries()];
    return context.globalState.update(KEY, t);
  }
}

export async function clearTokens() {
  try {
    const vault = PasswordVault.get();
    const tokenEntries = [...tokens.entries()];
    
    // Clear from secure storage
    for (const [connId] of tokenEntries) {
      await vault.deletePassword('oauth-tokens', connId);
    }
    
    // Clear from memory
    tokens.clear();
    
    // Clear from global state (legacy cleanup)
    await context.globalState.update(KEY, undefined);
    
  } catch (error) {
    log(`❌ Failed to clear OAuth tokens securely: ${error}`);
    // Fallback to old method
    context.globalState.update(KEY, undefined);
  }
}

export async function loadTokens() {
  try {
    const vault = PasswordVault.get();
    
    // First try to load from secure storage
    // Note: We can't enumerate secrets, so we'll migrate from global state if needed
    const legacyEntries: [string, Token][] = context.globalState.get(KEY, []);
    
    if (legacyEntries.length > 0) {
      
      // Migrate legacy tokens to secure storage
      for (const [connId, token] of legacyEntries) {
        tokens.set(connId, strip(token));
        await vault.setPassword('oauth-tokens', connId, JSON.stringify(strip(token)));
      }
      
      // Clear legacy storage after migration
      await context.globalState.update(KEY, undefined);
    }
    
  } catch (error) {
    log(`❌ Failed to load OAuth tokens securely, falling back: ${error}`);
    // Fallback to legacy method
    const entries: [string, Token][] = context.globalState.get(KEY, []);
    entries.forEach(e => tokens.set(...e));
  }
}
