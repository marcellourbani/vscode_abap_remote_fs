import { ExtensionContext } from "vscode"
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
