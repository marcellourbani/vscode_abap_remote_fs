import { Schema, model, connect } from "mongoose"
import { RemoteManager } from "./config"
import { MethodCall } from "method-call-logger"
import { log } from "./logger"
import { cache } from "./functions"
import { clientTraceUrl } from "vscode-abap-remote-fs-sharedapi"
import { LogPhase, LogData, RequestData, ResponseData } from "request-debug"
import {
  RequestAPI,
  Request,
  CoreOptions,
  RequiredUriUrl,
  Headers
} from "request"

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
  statelessClone: boolean
  method: string
  uri: string
  headers: Headers
  requestBody: any
  debugId: number
}
interface HttpLog extends HttpRequest {
  responseHeaders: Headers
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
  statelessClone: { type: Types.Boolean, required: true, index: false },
  duration: { type: Types.Number, required: true, index: false },
  // unknownResponse: { type: Types.Boolean, required: true, index: false },
  debugId: { type: Types.Number, required: true, index: true },
  method: { type: Types.String, required: true, index: true },
  statusCode: { type: Types.Number, required: true, index: true },
  uri: { type: Types.String, required: true, index: true },
  headers: { type: Types.Mixed, required: true, index: false },
  requestBody: { type: Types.Mixed, required: true, index: false },
  responseHeaders: { type: Types.Mixed, required: true, index: false },
  responseBody: { type: Types.Mixed, required: true, index: false }
})

class MongoClient {
  private connection: Promise<typeof import("mongoose")>
  private pendingRequests = new Map<number, HttpRequest>()
  private formatDbName(name: string): string {
    return `abapfs_${name.replace(/[\\\/\*\?\"<>\|\s,#]/g, "_").toLowerCase()}`
  }
  constructor(name: string, mongoUrl: string) {
    this.connection = connect(
      `${mongoUrl.replace(/\/$/, "")}/${this.formatDbName(name)}`,
      { useNewUrlParser: true }
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
          log(error.message || error.toString())
        }
      })
  }

  private toHttpRequest(
    request: RequestData,
    source: string,
    statelessClone: boolean
  ): HttpRequest {
    const { body: requestBody, ...rest } = request
    return {
      ...rest,
      requestBody,
      source,
      statelessClone,
      start: new Date().getTime()
    }
  }
  public httpLog(
    type: LogPhase,
    data: LogData,
    r: RequestAPI<Request, CoreOptions, RequiredUriUrl>,
    source: string,
    statelessClone: boolean
  ) {
    this.connection.then(async mongo => {
      switch (type) {
        case "request":
          const request = this.toHttpRequest(
            data as RequestData,
            source,
            statelessClone
          )
          this.pendingRequests.set(data.debugId, request)
          break
        case "response":
          const oldRequest = this.pendingRequests.get(data.debugId)
          if (!oldRequest)
            log(`Response received for unknown request ${data.debugId}`)
          else {
            const {
              headers: responseHeaders,
              statusCode,
              body: responseBody
            } = data as ResponseData
            const response: HttpLog = {
              ...oldRequest,
              statusCode,
              duration: new Date().getTime(),
              responseHeaders,
              responseBody
            }
            const logmodel = mongo.model(HTTPLOG)
            const doc = new logmodel(response)
            await doc.save()
          }
          break
        default:
          log(`Unexpected request type logged: ${type}`)
      }
    })
  }
}

const mongoClients = cache((name: string) => {
  const conf = name && RemoteManager.get().byId(name)
  const mongoUrl = conf && clientTraceUrl(conf)
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

export const mongoHttpLogger = (
  name: string,
  source: string,
  clone: boolean
) => {
  const mongo = mongoClients.get(name)
  if (mongo) return (call: MethodCall) => mongo.log(call, source, clone)
}
