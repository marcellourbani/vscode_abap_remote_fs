import { transportValidators } from "./adt/AdtTransports"
import { Disposable } from "vscode-languageclient"

export type TransportValidator = (
  transport: string,
  type: string,
  name: string,
  devClass: string
) => Promise<boolean>

function registerTransportValidator(v: TransportValidator) {
  if (transportValidators.indexOf(v) < 0) transportValidators.push(v)
  return {
    dispose: () => {
      const idx = transportValidators.indexOf(v)
      if (idx >= 0) transportValidators.splice(idx, 1)
    }
  }
}

export interface AbapFsApi {
  registerTransportValidator: (v: TransportValidator) => Disposable
}

export const api: AbapFsApi = { registerTransportValidator }
