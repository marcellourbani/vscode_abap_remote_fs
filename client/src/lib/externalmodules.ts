// keytar depends on a native module shipped in vscode
// this loads only the type definitions
import * as keytarType from "./keytar"

// get the module from vscode. This is not an official API, might break at some point
// this is required because keytar includes a binary we can't include
// see https://github.com/microsoft/vscode/issues/68738
function getCodeModule<T>(moduleName: string): T | undefined {
  // adapted from https://github.com/Microsoft/vscode-pull-request-github/blob/master/src/authentication/keychain.ts
  // I guess we use eval to load the embedded module at runtime
  // rather than allowing webpack to bundle it
  // tslint:disable-next-line: no-eval
  const vscodeRequire = eval("require")
  try {
    return vscodeRequire(moduleName)
  } catch (err) {
    return undefined
  }
}

let keytar: typeof keytarType | undefined
const keytarErr = () => new Error("Error accessing system secure store")

export class PasswordVault {
  constructor() {
    if (!keytar) keytar = getCodeModule<typeof keytarType>("keytar")
  }

  getPassword(service: string, account: string) {
    if (!keytar) throw keytarErr()
    return keytar.getPassword(service, account)
  }

  setPassword(service: string, account: string, password: string) {
    if (!keytar) throw keytarErr()
    return keytar.setPassword(service, account, password)
  }

  deletePassword(service: string, account: string) {
    if (!keytar) throw keytarErr()
    return keytar.deletePassword(service, account)
  }

  acounts(service: string) {
    if (!keytar) throw keytarErr()
    return keytar.findCredentials(service)
  }
}
