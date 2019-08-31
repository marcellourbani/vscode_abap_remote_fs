import { MethodCall } from "method-call-logger"
import { ApiResponse, Client } from "@elastic/elasticsearch"
import { log } from "console"
import { cache } from "./functions"
import { RemoteManager, RemoteConfig } from "./config"
const ELASTICSCHEMA = {
  mappings: {
    properties: {
      methodName: { type: "keyword" },
      source: { type: "keyword" },
      statelessClone: { type: "boolean" },
      callType: { type: "keyword" },
      start: { type: "long" },
      duration: { type: "long" },
      failed: { type: "boolean" },
      resolvedPromise: { type: "boolean" },
      callDetails: { type: "nested", dynamic: false }
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
        this.elastic.create({
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
    res = await this.elastic.indices.exists({ index: this.elasticIndex })
    if (hasFailed(res))
      if (res.statusCode && res.statusCode < 500)
        res = await this.elastic.indices.create({
          index: this.elasticIndex,
          body
        })
    if (hasFailed(res)) {
      const failure = "Failed to connect to ElasticSearch"
      log(failure)
      log(JSON.stringify(res))
      throw new Error(failure)
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
    return {
      methodName,
      callType,
      source,
      statelessClone,
      start,
      duration,
      failed,
      resolvedPromise,
      callDetails
    }
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
