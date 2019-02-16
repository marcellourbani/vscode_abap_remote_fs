import { ADTClient, createSSLConfig } from "abap-adt-api"
import { createConnection, ProposedFeatures } from "vscode-languageserver"
import { isString, isError } from "util"
import { readConfiguration } from "./clientapis"
const clients: Map<string, ADTClient> = new Map()

export const connection = createConnection(ProposedFeatures.all)
export const log = (x: any) => {
  let msg = ""
  try {
    if (isError(x)) msg = `\nError ${x.name}\n${x.message}\n\n${x.stack}\n`
    else msg = isString(x) ? x : JSON.stringify(x)
  } catch (e) {
    msg = x.toString()
  }
  connection.console.log(msg)
}

export async function clientFromUrl(url: string) {
  const match = url.match(/adt:\/\/([^\/]*)/)
  const key = match && match[1]
  if (!key) return

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
      clients.set(key, client)
    }
  }
  return client
}
