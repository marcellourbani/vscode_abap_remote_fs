export enum Methods {
  objectDetails = "vscabap.objDetails",
  readConfiguration = "vscabap.readConfig",
  readEditorObjectSource = "vscabap.editObjSource",
  readObjectSourceOrMain = "vscabap.mainObjSource",
  setSearchProgress = "vscabap.setSearchProgress",
  cancelSearch = "vscabap.cancelSearch",
  vsUri = "vscabap.vsUri",
  quickFix = "vscabap.quickfix"
}

export interface AbapObjectDetail {
  url: string
  mainUrl: string
  mainProgram?: string
  type: string
  name: string
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
  url: string
  source: string
}

export interface StringWrapper {
  s: string
}

export interface UriRequest {
  confKey: string
  uri: string
  mainInclude: boolean
}

export interface SearchProgress {
  progress: number
  hits: number
  ended: boolean
}

export const urlFromPath = (configKey: string, path: string) =>
  `adt://${configKey}${path}`

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}

export const stripExtension = (u: string) => u.replace(/\.abap/, "")
