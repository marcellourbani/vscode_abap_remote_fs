export enum Methods {
  objectDetails = "vscabap.objDetails",
  readConfiguration = "vscabap.readConfig",
  readObjectSource = "vscabap.objSource"
}

export interface AbapObjectDetail {
  url: string
  mainUrl: string
  mainProgram?: string
  type: string
}

export interface ClientConfiguration {
  name: string
  url: string
  username: string
  password: string
  client: string
  language: string
  allowSelfSigned: boolean
  customCA: string
}

export interface AbapObjectSource {
  source: string
}

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}
