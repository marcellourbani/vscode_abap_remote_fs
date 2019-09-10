import { MethodCall } from "method-call-logger"
import { ApiResponse, Client } from "@elastic/elasticsearch"
import { cache } from "./functions"
import { RemoteManager, RemoteConfig } from "./config"
import { log } from "./logger"
const ELASTICSCHEMA = {
  mappings: {
    properties: {
      // tslint:disable: object-literal-key-quotes
      methodName: { type: "keyword" },
      source: { type: "keyword" },
      statelessClone: { type: "boolean" },
      callType: { type: "keyword" },
      "@timestamp": { type: "date", format: "epoch_millis" },
      duration: { type: "long" },
      failed: { type: "boolean" },
      resolvedPromise: { type: "boolean" },
      callDetails: { type: "text", index: false }
    }
  }
}
const hasFailed = (resp: ApiResponse<any, any>) =>
  !resp.statusCode || resp.statusCode >= 300

class ElasticClient {
  private currentId: number
  private connected: Promise<any>
  private elastic: Client
  private elasticIndex: string
  constructor(private conf: RemoteConfig) {
    this.elasticIndex = this.formatElasticIndexname(this.conf.name)
    this.currentId = Date.now()
    this.elastic = new Client({ node: conf.elasticUrl })
    this.connected = this.connect()
  }
  public log = async (
    call: MethodCall,
    source: string,
    statelessClone: boolean
  ) => {
    if (call.resolvedPromise) {
      await this.connected // if connection failed nothing will be logged
      try {
        await this.elastic.create({
          id: this.getId(),
          index: this.elasticIndex,
          body: this.toElasticDocument(call, source, statelessClone)
        })
      } catch (error) {
        log(
          `failed to log ${call.methodName} to elastic:${error.message ||
            error.toString()}`
        )
      }
    }
  }
  private getId = () => `${this.currentId++}`
  private formatElasticIndexname(name: string): string {
    return `abapfs_${name.replace(/[\\\/\*\?\"<>\|\s,#]/g, "_").toLowerCase()}`
  }
  private connect = async () => {
    let res

    const body = ELASTICSCHEMA
    try {
      res = await this.elastic.indices.exists({ index: this.elasticIndex })
      if (hasFailed(res))
        if (res.statusCode && res.statusCode < 500)
          res = await this.elastic.indices.create({
            index: this.elasticIndex,
            body
          })
      if (hasFailed(res)) {
        throw new Error(JSON.stringify(res))
      }
    } catch (error) {
      log(`Failed to connect to ElasticSearch\n${JSON.stringify(error)}`)
      throw error
    }
  }
  private toElasticDocument = (
    call: MethodCall,
    source: string,
    statelessClone: boolean
  ) => {
    const {
      methodName,
      callType,
      start,
      duration,
      failed,
      resolvedPromise,
      ...callDetails
    } = call
    const retval = {
      methodName,
      callType,
      source,
      statelessClone,
      "@timestamp": start,
      duration,
      failed,
      resolvedPromise,
      callDetails: JSON.stringify(callDetails)
    }
    log(`${retval.callDetails.length}`)
    return retval
  }
}

const elasticClients = cache((name: string) => {
  const conf = name && RemoteManager.get().byId(name)
  if (!conf || !conf.elasticUrl) return undefined
  return new ElasticClient(conf)
})

export const elasticLogger = (name: string, source: string, clone: boolean) => {
  const elastic = elasticClients.get(name)
  if (elastic) return (call: MethodCall) => elastic.log(call, source, clone)
}
