import { AbapObjectSource } from "./../../sharedtypes/out/index.d"
import { AbapObject } from "./adt/abap/AbapObject"
import { log, channel } from "./logger"
import { AbapObjectDetail, Methods } from "sharedtypes"
import { ExtensionContext, Uri, window } from "vscode"
import { LanguageClient, TransportKind, State } from "vscode-languageclient"
import { ADTSCHEME, fromUri } from "./adt/AdtServer"
import { configFromId } from "./config"
import { isString } from "util"
export let client: LanguageClient
import { join } from "path"

const includes: Map<string, string> = new Map()

async function readObjectSource(uri: string) {
  const current = window.visibleTextEditors.find(
    e =>
      e.document.uri.scheme === ADTSCHEME && e.document.uri.toString() === uri
  )
  if (current)
    return {
      source: current.document.getText()
    } as AbapObjectSource
}

function objectDetail(obj: AbapObject, mainProgram?: string) {
  if (!obj) return
  const detail: AbapObjectDetail = {
    url: obj.path,
    mainUrl: obj.getContentsUri(),
    mainProgram,
    type: obj.type
  }
  return detail
}
async function objectDetailFromUrl(url: string) {
  const uri = Uri.parse(url)
  const server = await fromUri(uri)
  const obj = await server.findAbapObject(uri)
  return objectDetail(obj, includes.get(url))
}

async function configFromUrl(url: string) {
  const { sapGui, ...cfg } = configFromId(url)
  return cfg
}

export async function manageIncludes(uri: Uri, opened: boolean) {
  const key = uri.toString()
  if (opened) {
    const include = includes.get(key)
    if (isString(include)) return
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (obj.type !== "PROG/I") includes.set(key, "")
    else {
      let main = ""
      try {
        main = await await server.activator.selectMain(obj)
      } finally {
        includes.set(key, main || "")
        // if(main)
      }
    }
  } else includes.delete(key)
}

export async function startLanguageClient(context: ExtensionContext) {
  const module = context.asAbsolutePath(join("server", "out", "server.js"))
  const transport = TransportKind.ipc
  const options = { execArgv: ["--nolazy", "--inspect=6009"] }
  log("creating language client...")

  client = new LanguageClient(
    "ABAPFS_LC",
    "Abap FS Language client",
    {
      run: { module, transport },
      debug: { module, transport, options }
    },
    {
      documentSelector: [{ language: "abap", scheme: ADTSCHEME }],
      outputChannel: channel
    }
  )
  log("starting language client...")

  client.start()

  client.onDidChangeState(e => {
    if (e.newState === State.Running) {
      client.onRequest(Methods.readConfiguration, configFromUrl)
      client.onRequest(Methods.objectDetails, objectDetailFromUrl)
      client.onRequest(Methods.readObjectSource, readObjectSource)
    }
  })
}
