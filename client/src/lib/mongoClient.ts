import { Schema, connect } from "mongoose"
import { RemoteManager } from "../config"
import { MethodCall } from "method-call-logger"
import { log } from "./logger"
import { cache } from "./functions"
import { clientTraceUrl, Sources, httpTraceUrl } from "vscode-abap-remote-fs-sharedapi"
import { LogCallback, LogData, session_types } from "abap-adt-api"
import { caughtToString } from "."
import { AxiosRequestHeaders, RawAxiosRequestHeaders } from "axios"

const CALLLOG = "callLog"
const HTTPLOG = "httpLog"
const { Types } = Schema

interface CallLog {
  start: number
  callType: string
  source: string
  statelessClone: boolean
  methodName: string
  duration: number
  failed: boolean
  resolvedPromise: boolean
  callDetails: any
}

interface HttpRequest {
  start: number
  source: string
  stateful: boolean
  method: string
  uri: string
  headers: Record<string, string | string[] | number>
  requestBody: any
  debugId: number
}
interface HttpLog extends HttpRequest {
  responseHeaders: Record<string, string | string[] | number>
  duration: number
  statusCode: number
  // unknownResponse: boolean
  responseBody: any
}

const callSchema = new Schema({
  start: { type: Types.Number, required: true, index: true },
  methodName: { type: Types.String, required: true, index: true },
  source: { type: Types.String, required: true, index: true },
  statelessClone: { type: Types.Boolean, required: true, index: false },
  callType: { type: Types.String, required: true, index: false },
  duration: { type: Types.Number, required: true, index: false },
  failed: { type: Types.Boolean, required: true, index: false },
  resolvedPromise: { type: Types.Boolean, required: true, index: false },
  callDetails: { type: Types.Mixed, required: true, index: false }
})

const httpSchema = new Schema({
  start: { type: Types.Number, required: true, index: true },
  source: { type: Types.String, required: true, index: true },
  stateful: { type: Types.Boolean, required: true, index: false },
  duration: { type: Types.Number, required: true, index: false },
  // unknownResponse: { type: Types.Boolean, required: true, index: false },
  debugId: { type: Types.Number, required: true, index: true },
  method: { type: Types.String, required: true, index: true },
  statusCode: { type: Types.Number, required: true, index: true },
  uri: { type: Types.String, required: true, index: true },
  headers: { type: Types.Mixed, required: true, index: false },
  requestBody: { type: Types.Mixed, required: false, index: false },
  responseHeaders: { type: Types.Mixed, required: true, index: false },
  responseBody: { type: Types.Mixed, required: false, index: false }
})

class MongoClient {
  private connection: Promise<typeof import("mongoose")>
  private formatDbName(name: string): string {
    return `abapfs_${name.replace(/[\\\/\*\?\"<>\|\s,#]/g, "_").toLowerCase()}`
  }
  constructor(name: string, mongoUrl: string) {
    this.connection = connect(
      `${mongoUrl.replace(/\/$/, "")}/${this.formatDbName(name)}`
    ).then(async mongo => {
      mongo.model(CALLLOG, callSchema)
      mongo.model(HTTPLOG, httpSchema)
      return mongo
    })
  }
  private toCallLog(
    call: MethodCall,
    source: string,
    statelessClone: boolean
  ): CallLog {
    const {
      methodName,
      callType,
      start,
      duration,
      failed,
      resolvedPromise,
      ...callDetails
    } = call
    return {
      start,
      callType,
      source,
      statelessClone,
      methodName,
      duration,
      failed,
      resolvedPromise,
      callDetails
    }
  }
  public log = (call: MethodCall, source: string, statelessClone: boolean) => {
    if (call.resolvedPromise)
      this.connection.then(async mongo => {
        try {
          const logmodel = mongo.model(CALLLOG)
          const doc = new logmodel(this.toCallLog(call, source, statelessClone))
          await doc.save()
        } catch (error) {
          log(caughtToString(error))
        }
      })
  }

  private toHttpRequest(logdata: LogData, source: string): HttpRequest {
    const { body: requestBody, ...rest } = logdata.request
    const s = logdata.request.headers["X-sap-adt-sessiontype"]
    const stateful = s === session_types.stateful || s === session_types.keep

    return {
      ...rest,
      requestBody,
      source,
      stateful,
      start: new Date().getTime(),
      debugId: logdata.id
    }
  }

  public httpLog(data: LogData, source: Sources) {
    this.connection.then(async mongo => {
      const request = this.toHttpRequest(data, source)
      const {
        headers: responseHeaders,
        statusCode,
        body: responseBody
      } = data.response
      const response: HttpLog = {
        ...request,
        statusCode,
        duration: new Date().getTime() - request.start,
        responseHeaders,
        responseBody
      }
      const logmodel = mongo.model(HTTPLOG)
      const doc = new logmodel(response)
      await doc.save()
    })
  }
}

const mongoClients = cache((name: string) => {
  const conf = name && RemoteManager.get().byId(name)
  const mongoUrl = conf && (clientTraceUrl(conf) || httpTraceUrl(conf))
  if (!conf || !mongoUrl) return undefined
  return new MongoClient(conf.name, mongoUrl)
})

export const mongoApiLogger = (
  name: string,
  source: string,
  clone: boolean
) => {
  const mongo = mongoClients.get(name)
  if (mongo) return (call: MethodCall) => mongo.log(call, source, clone)
}

export const mongoHttpLogger = (name: string, source: Sources): LogCallback | undefined => {
  const mongo = mongoClients.get(name)
  if (mongo)
    return (data: LogData) => mongo.httpLog(data, source)
}
