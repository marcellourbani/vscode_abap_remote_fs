import { Schema, model, connect } from "mongoose"
import { RemoteConfig, RemoteManager } from "./config"
import { MethodCall } from "method-call-logger"
import { log } from "./logger"
import { cache } from "./functions"

const CALLLOG = "callLog"
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

const callModel = model(CALLLOG, callSchema)

class MongoClient {
  private connection: Promise<typeof import("mongoose")>
  private formatDbName(name: string): string {
    return `abapfs_${name.replace(/[\\\/\*\?\"<>\|\s,#]/g, "_").toLowerCase()}`
  }
  constructor(conf: RemoteConfig) {
    const mongoUrl = conf.mongoUrl.replace(/\/$/, "")
    this.connection = connect(
      `mongodb://127.0.0.1:27017/${this.formatDbName(conf.name)}`,
      { useNewUrlParser: true }
    ).then(async mongo => {
      await mongo.model(CALLLOG, callSchema)
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
}

const mongoClients = cache((name: string) => {
  const conf = name && RemoteManager.get().byId(name)
  if (!conf || !conf.mongoUrl) return undefined
  return new MongoClient(conf)
})

export const mongoLogger = (name: string, source: string, clone: boolean) => {
  const mongo = mongoClients.get(name)
  if (mongo) return (call: MethodCall) => mongo.log(call, source, clone)
}
