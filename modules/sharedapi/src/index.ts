import { LogData } from "abap-adt-api"
export enum Methods {
  objectDetails = "vscabap.objDetails",
  readConfiguration = "vscabap.readConfig",
  readEditorObjectSource = "vscabap.editObjSource",
  readObjectSourceOrMain = "vscabap.mainObjSource",
  setSearchProgress = "vscabap.setSearchProgress",
  cancelSearch = "vscabap.cancelSearch",
  vsUri = "vscabap.vsUri",
  updateMainProgram = "vscabap.updateMain",
  getToken = "vscabap.getToken",
  triggerSyntaxCheck = "vscabap.triggerSyntaxCheck",
  commLogEntry = "vscabap.commLogEntry",
  commLogToggle = "vscabap.commLogToggle",
  codeCompletionFull = "vscabap.codeCompletionFull"
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
  customCA?: string
  diff_formatter: "ADT formatter" | "AbapLint" | "Simple"
  oauth?: {
    clientId: string
    clientSecret: string
    loginUrl: string
    saveCredentials?: boolean
  }
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

export interface MainProgram {
  includeUri: string
  mainProgramUri: string
}

export interface CommLogTogglePayload {
  active: boolean
  connId: string
}

export const urlFromPath = (configKey: string, path: string) => `adt://${configKey}${path}`

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}

export const stripExtension = (u: string) => u.replace(/\.abap/, "")

/** Comm log entry forwarded from server to client */
export interface CommLogEntryData {
  connId: string
  logData: LogData
}
