import { MainProgram, HttpLogEntry } from "vscode-abap-remote-fs-sharedapi"
import {
  log,
  channel,
  mongoApiLogger,
  mongoHttpLogger,
  rangeApi2Vsc
} from "./lib"
import {
  AbapObjectDetail,
  Methods,
  StringWrapper,
  AbapObjectSource,
  urlFromPath,
  UriRequest,
  SearchProgress,
  LogEntry
} from "vscode-abap-remote-fs-sharedapi"
import {
  ExtensionContext,
  Uri,
  window,
  ProgressLocation,
  commands,
  workspace,
  WorkspaceEdit
} from "vscode"
import {
  LanguageClient,
  TransportKind,
  State,
  RevealOutputChannelOn
} from "vscode-languageclient"
export let client: LanguageClient
import { join } from "path"
import { FixProposal, Delta } from "abap-adt-api"
import { command, AbapFsCommands } from "./commands"
import { RemoteManager, formatKey } from "./config"
import { futureToken } from "./oauth"
import { getRoot, ADTSCHEME, uriRoot, getClient } from "./adt/conections"
import { isAbapFile } from "abapfs"
import { AbapObject } from "abapobject"
import { IncludeService, IncludeProvider } from "./adt/includes"
import * as R from "ramda"

async function getVSCodeUri(req: UriRequest): Promise<StringWrapper> {
  const root = getRoot(req.confKey)
  const hit = await root.findByAdtUri(req.uri, req.mainInclude)
  if (!hit) throw new Error(`File not found:${req.uri}`)
  return { s: urlFromPath(req.confKey, hit.path) }
}
export function findEditor(url: string) {
  return window.visibleTextEditors.find(
    e =>
      e.document.uri.scheme === ADTSCHEME && e.document.uri.toString() === url
  )
}
async function readEditorObjectSource(url: string) {
  const current = findEditor(url)
  const source: AbapObjectSource = { source: "", url }
  if (current) source.source = current.document.getText()
  return source
}

async function readObjectSource(uri: string) {
  const source = await readEditorObjectSource(uri)
  if (source.source) return source

  const url = Uri.parse(uri)
  const root = uriRoot(url)
  const file = (await root.getNodeAsync(url.path)) || {}
  if (!isAbapFile(file)) throw new Error(`File not found:${uri}`)
  const code = await file.read()
  return { source: code, url: url.toString() }
}

function objectDetail(obj: AbapObject, mainProgram?: string) {
  if (!obj) return
  const detail: AbapObjectDetail = {
    url: obj.path,
    mainUrl: obj.contentsPath(),
    mainProgram,
    type: obj.type,
    name: obj.name
  }
  return detail
}

async function objectDetailFromUrl(url: string) {
  const uri = Uri.parse(url)
  const root = uriRoot(uri)
  const obj = await root.getNodeAsync(uri.path)
  if (!isAbapFile(obj)) throw new Error("not found") // TODO error
  let mainProgram
  if (obj.object.type === "PROG/I")
    mainProgram = IncludeService.get(uri.authority).current(uri.path)
  return objectDetail(obj.object, mainProgram?.["adtcore:uri"])
}

async function configFromKey(connId: string) {
  const { sapGui, ...cfg } = (await RemoteManager.get()).byId(connId)!
  return cfg
}
async function getToken(connId: string) {
  return futureToken(formatKey(connId))
}

let setProgress: ((prog: SearchProgress) => void) | undefined
async function setSearchProgress(searchProg: SearchProgress) {
  if (setProgress) setProgress(searchProg)
  else if (!searchProg.ended) {
    window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: "Where used list in progress - "
      },
      (progress, token) => {
        let current = 0
        let resPromise: () => void
        const result = new Promise(resolve => {
          resPromise = resolve
        })
        token.onCancellationRequested(async () => {
          setProgress = undefined
          await client.sendRequest(Methods.cancelSearch)
          if (resPromise) resPromise()
        })
        setProgress = (s: SearchProgress) => {
          if (s.ended) {
            setProgress = undefined
            if (resPromise) resPromise()
            return
          }
          progress.report({
            increment: s.progress - current,
            message: `Searching usage references, ${s.hits} hits found so far`
          })
          current = s.progress
        }
        setProgress(searchProg)
        return result
      }
    )
  }
}

async function includeChanged(prog: MainProgram) {
  await client.sendRequest(Methods.updateMainProgram, prog)
}

function logCall(entry: LogEntry) {
  const logger = mongoApiLogger(entry.connection, entry.source, entry.fromClone)
  if (logger) logger(entry.call)
}
function logHttp(entry: HttpLogEntry) {
  const logger = mongoHttpLogger(entry.connection, entry.source)
  if (logger) logger(entry.type, entry.data)
}
export async function startLanguageClient(context: ExtensionContext) {
  const module = context.asAbsolutePath(join("server", "dist", "server.js"))
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
      documentSelector: [
        { language: "abap", scheme: ADTSCHEME },
        { language: "abap_cds", scheme: ADTSCHEME }
      ],
      outputChannel: channel,
      revealOutputChannelOn: RevealOutputChannelOn.Warn
    }
  )
  log("starting language client...")

  IncludeProvider.get().onDidSelectInclude(includeChanged)

  client.onDidChangeState(e => {
    if (e.newState === State.Running) {
      client.onRequest(Methods.readConfiguration, configFromKey)
      client.onRequest(Methods.objectDetails, objectDetailFromUrl)
      client.onRequest(Methods.readEditorObjectSource, readEditorObjectSource)
      client.onRequest(Methods.readObjectSourceOrMain, readObjectSource)
      client.onRequest(Methods.vsUri, getVSCodeUri)
      client.onRequest(Methods.setSearchProgress, setSearchProgress)
      client.onRequest(Methods.logCall, logCall)
      client.onRequest(Methods.logHTTP, logHttp)
      client.onRequest(Methods.getToken, getToken)
    }
  })
  client.start()
}

export class LanguageCommands {
  public static start(context: ExtensionContext) {
    command(AbapFsCommands.quickfix)(this, "applyQuickFix")
    return startLanguageClient(context)
  }

  public static async applyQuickFix(proposal: FixProposal, uri: string) {
    const u = Uri.parse(uri)
    const cl = getClient(u.authority)

    const source = await readEditorObjectSource(uri)

    const deltaLine = (d: Delta) => d.range.start.line
    const sortDelta = R.sortWith<Delta>([
      R.ascend(R.prop("uri")),
      R.descend(deltaLine)
    ])

    const deltas = await cl.fixEdits(proposal, source.source).then(sortDelta)
    if (!deltas || deltas.length === 0) return
    const we = new WorkspaceEdit()
    const touched = new Set<string>()

    for (const d of deltas) {
      const ur = await getVSCodeUri({
        uri: d.uri,
        confKey: u.authority,
        mainInclude: true
      })
      if (!ur.s) continue
      touched.add(ur.s)
      const range = rangeApi2Vsc(d.range)
      we.replace(Uri.parse(ur.s), range, d.content)
    }
    const result = await workspace.applyEdit(we)

    if (result)
      for (const docUri of touched) {
        const docs = [...workspace.textDocuments]
        const key = Uri.parse(docUri).toString()
        const doc = docs.find(d => d.uri.toString() === key)
        if (doc) {
          await window.showTextDocument(doc)
          await commands.executeCommand("editor.action.formatDocument")
        }
      }
  }
}
