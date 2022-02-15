import { MethodCall } from "method-call-logger"
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
  logCall = "vscabap.logCall",
  logHTTP = "vscabap.logHTTP",
  getToken = "vscabap.getToken"
}

export type Sources = "client" | "server"
export const SOURCE_CLIENT: Sources = "client"
export const SOURCE_SERVER: Sources = "server"

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
  diff_formatter: "ADT formatter" | "AbapLint" | "Simple",
  oauth?: {
    clientId: string
    clientSecret: string
    loginUrl: string
    saveCredentials?: boolean
  }
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
  source: Sources
  fromClone: boolean
  call: MethodCall
}

export interface HttpLogEntry {
  connection: string
  source: Sources
  data: LogData
}

export const urlFromPath = (configKey: string, path: string) =>
  `adt://${configKey}${path}`

export function objectIsValid(obj?: AbapObjectDetail) {
  if (!obj) return false
  return obj.type !== "PROG/I" || !!obj.mainProgram
}

export const stripExtension = (u: string) => u.replace(/\.abap/, "")
