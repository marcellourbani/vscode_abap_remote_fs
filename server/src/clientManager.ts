import { ADTClient, createSSLConfig } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { isString, isError } from "util"
import { readConfiguration, sendLog } from "./clientapis"
import { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"
import { createProxy, MethodCall } from "method-call-logger"
const clients: Map<string, ADTClient> = new Map()

export const connection = createConnection(ProposedFeatures.all)
export const error = (...params: any) =>
  connection.console.error(convertParams(...params))
export const warn = (...params: any) =>
  connection.console.warn(convertParams(...params))
export const info = (...params: any) =>
  connection.console.info(convertParams(...params))
export const log = (...params: any) =>
  connection.console.log(convertParams(...params))

export function clientKeyFromUrl(url: string) {
  const match = url.match(/adt:\/\/([^\/]*)/)
  return match && match[1]
}

function loggedProxy(client: ADTClient, conf: ClientConfiguration) {
  const temp = {
    connection: conf.name,
    source: "server",
    fromClone: false
  }
  const logger = (call: MethodCall) => sendLog({ ...temp, call })
  const cloneLogger = (call: MethodCall) =>
    sendLog({ ...temp, call, fromClone: true })

  const clone = createProxy(client.statelessClone, cloneLogger)

  return createProxy(client, logger, {
    resolvePromises: true,
    getterOverride: new Map([["statelessClone", () => clone]])
  })
}
export async function clientFromKey(key: string) {
  let client = clients.get(key)
  if (!client) {
    const conf = await readConfiguration(key)
    if (conf) {
      const sslconf = conf.url.match(/https:/i)
        ? createSSLConfig(conf.allowSelfSigned, conf.customCA)
        : {}
      client = new ADTClient(
        conf.url,
        conf.username,
        conf.password,
        conf.client,
        conf.language,
        sslconf
      )
      if (conf.elasticUrl) client = loggedProxy(client, conf)
      clients.set(key, client)
    }
  }
  return client
}

export async function clientFromUrl(url: string) {
  const key = clientKeyFromUrl(url)
  if (!key) return
  return clientFromKey(key)
}

function convertParams(...params: any) {
  let msg = ""
  for (const x of params) {
    try {
      if (isError(x)) msg += `\nError ${x.name}\n${x.message}\n\n${x.stack}\n`
      else msg += isString(x) ? x : JSON.stringify(x)
    } catch (e) {
      msg += x.toString()
    }
    msg += " "
  }
  return msg
}
