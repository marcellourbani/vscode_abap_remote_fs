import { MainProgram } from "vscode-abap-remote-fs-sharedapi"
import { AbapObject } from "./adt/abap/AbapObject"
import { log, channel } from "./logger"
import {
  AbapObjectDetail,
  Methods,
  StringWrapper,
  AbapObjectSource,
  urlFromPath,
  UriRequest,
  SearchProgress
} from "vscode-abap-remote-fs-sharedapi"
import {
  ExtensionContext,
  Uri,
  window,
  ProgressLocation,
  TextEdit,
  commands
} from "vscode"
import {
  LanguageClient,
  TransportKind,
  State,
  RevealOutputChannelOn
} from "vscode-languageclient"
import { ADTSCHEME, fromUri, getServer } from "./adt/AdtServer"
import { configFromId } from "./config"
import { isString } from "util"
export let client: LanguageClient
import { join } from "path"
import {
  findMainIncludeAsync,
  uriToNodePath
} from "./adt/abap/AbapObjectUtilities"
import { isAbapNode } from "./fs/AbapNode"
import { FixProposal } from "abap-adt-api"
import { fail } from "assert"
import { command, AbapFsCommands } from "./commands"
import { IncludeLensP } from "./adt/operations/IncludeLens"

async function getVSCodeUri(req: UriRequest): Promise<StringWrapper> {
  const server = getServer(req.confKey)
  return { s: await server.objectFinder.vscodeUri(req.uri, req.mainInclude) }
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
  const server = fromUri(url)
  let nodep = uriToNodePath(url, await server.findNodePromise(url))
  if (nodep.node.isFolder)
    nodep = (await findMainIncludeAsync(nodep, server.client)) || nodep
  if (nodep && !nodep.node.isFolder) {
    source.url = urlFromPath(server.connectionId, nodep.path)
    if (isAbapNode(nodep.node) && !nodep.node.abapObject.structure)
      nodep.node.stat(server.client)
    source.source = (await nodep.node.fetchContents(server.client)).toString()
  }
  return source
}

function objectDetail(obj: AbapObject, mainProgram?: string) {
  if (!obj) return
  const detail: AbapObjectDetail = {
    url: obj.path,
    mainUrl: obj.getContentsUri(),
    mainProgram,
    type: obj.type,
    name: obj.name
  }
  return detail
}

async function objectDetailFromUrl(url: string) {
  const uri = Uri.parse(url)
  const server = await fromUri(uri)
  const obj = await server.findAbapObject(uri)
  let mainProgram
  if (obj.type === "PROG/I")
    mainProgram = await IncludeLensP.get().guessMain(uri)
  return objectDetail(obj, mainProgram)
}

async function configFromUrl(url: string) {
  const { sapGui, ...cfg } = configFromId(url)
  return cfg
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
        { language: "cds", scheme: ADTSCHEME }
      ],
      outputChannel: channel,
      revealOutputChannelOn: RevealOutputChannelOn.Warn
    }
  )
  log("starting language client...")

  IncludeLensP.get().onDidSelectInclude(includeChanged)

  client.onDidChangeState(e => {
    if (e.newState === State.Running) {
      client.onRequest(Methods.readConfiguration, configFromUrl)
      client.onRequest(Methods.objectDetails, objectDetailFromUrl)
      client.onRequest(Methods.readEditorObjectSource, readEditorObjectSource)
      client.onRequest(Methods.readObjectSourceOrMain, readObjectSource)
      client.onRequest(Methods.vsUri, getVSCodeUri)
      client.onRequest(Methods.setSearchProgress, setSearchProgress)
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
    try {
      const edits = (await client.sendRequest(Methods.quickFix, {
        proposal,
        uri
      })) as TextEdit[]
      const editor = findEditor(uri)

      const msg = (e?: Error) =>
        window.showErrorMessage(
          "Failed to apply ABAPfs fix to the document" + e ? e!.toString() : ""
        )

      if (editor && edits) {
        const success = await editor.edit(mutator => {
          for (const edit of edits) {
            if (edit.range.start.character !== edit.range.end.character)
              mutator.replace(
                client.protocol2CodeConverter.asRange(edit.range),
                edit.newText
              )
            else
              mutator.insert(
                client.protocol2CodeConverter.asPosition(edit.range.start),
                "\n" + edit.newText + "\n"
              )
          }
        })

        if (success)
          commands.executeCommand("editor.action.formatDocument", editor)
        else msg()
      }
    } catch (e) {
      fail(e)
    }
  }
}
