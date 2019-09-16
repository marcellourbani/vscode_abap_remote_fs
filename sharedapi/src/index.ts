import { MethodCall } from "method-call-logger"
export enum Methods {
  objectDetails = "vscabap.objDetails",
  readConfiguration = "vscabap.readConfig",
  readEditorObjectSource = "vscabap.editObjSource",
  readObjectSourceOrMain = "vscabap.mainObjSource",
  setSearchProgress = "vscabap.setSearchProgress",
  cancelSearch = "vscabap.cancelSearch",
  vsUri = "vscabap.vsUri",
  quickFix = "vscabap.quickfix",
  updateMainProgram = "vscabap.updateMain",
  logCall = "vscabap.logCall"
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
  trace?: {
    mongoUrl: string
    api_methods: boolean
    http_calls: boolean
  }
}

export const clientTraceUrl = (conf: ClientConfiguration) =>
  conf.trace && conf.trace.api_methods && conf.trace.mongoUrl

export const httpTraceUrl = (conf: ClientConfiguration) =>
  conf.trace && conf.trace.http_calls && conf.trace.mongoUrl

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

export interface LogEntry {
  connection: string
  source: string
  fromClone: boolean
  call: MethodCall
}

export const urlFromPath = (configKey: string, path: string) =>
  `adt://${configKey}${path}`

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}

export const stripExtension = (u: string) => u.replace(/\.abap/, "")
