import { ExtensionContext } from "vscode"

/**
 * Secure password storage using VS Code's built-in secrets API.
 * @security This class does NOT send any data outside the application.
 * All credentials are stored locally in VS Code's encrypted secret storage
 * (ExtensionContext.secrets) which uses the OS keychain/credential manager.
 * Checkmarx false positive: CWE-359 - This is secure local storage, not external transmission.
 */
export class PasswordVault {
  private static instance: PasswordVault
  constructor(private context: ExtensionContext) {
    PasswordVault.instance = this
  }

  getPassword(service: string, account: string) {
    return this.context.secrets.get(`${service}:${account}`)
  }

  setPassword(service: string, account: string, password: string) {
    return this.context.secrets.store(`${service}:${account}`, password)
  }

  deletePassword(service: string, account: string) {
    return this.context.secrets.delete(`${service}:${account}`)
  }
  async accounts(service: string): Promise<{ account: string, password: string }[]> {
    return [] //TODO:implement or remove
  }
  static get() {
    if (!PasswordVault.instance) throw new Error("No password vault defined")
    return PasswordVault.instance
  }
}
