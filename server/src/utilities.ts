import { DiagnosticSeverity, TextDocument, Range } from "vscode-languageserver"
import { isString } from "util"
import { ADTClient } from "abap-adt-api"
import { AbapObjectDetail } from "vscode-abap-remote-fs-sharedapi"
import { clientKeyFromUrl, clientFromKey } from "./clientManager"
import { getObject } from "./objectManager"
import { getEditorObjectSource } from "./clientapis"
import { toInt, parts } from "./functions"

const startIdent = /^((<?[\w]+>?)|(\/\w+\/\w+))/
const endIdent = /((<?[\w]+>?)|(\/\w+\/\w+))$/

export function decodeSeverity(severity: string) {
  switch (severity) {
    case "E":
    case "A":
    case "X":
      return DiagnosticSeverity.Error
    case "W":
      return DiagnosticSeverity.Warning
    case "I":
    case "S":
      return DiagnosticSeverity.Information
  }
  return DiagnosticSeverity.Warning
}

export function sourceRange(
  document: TextDocument | string,
  oline: number,
  character: number
): Range {
  const line = oline === 0 ? 0 : oline - 1
  if (isString(document)) {
    const lineText = document.split("\n")[line]
    const lastwordm = lineText.substr(0, character).match(endIdent)
    const start = { line, character }
    if (lastwordm) start.character -= lastwordm[1].length
    const end = { line, character: character + 1000 }
    const match = lineText.substr(start.character).match(startIdent)
    end.character = start.character + (match ? match[1].length : 1)
    return { start, end }
  } else {
    const start = { line, character }
    const end = { line, character: character + 1000 }
    const match = document.getText({ start, end }).match(startIdent)
    end.character = start.character + (match ? match[1].length : 1)
    return { start, end }
  }
}

export function rangeFromUri(uri: string): Range | undefined {
  const [startl, startc, endl, endc] = parts(
    uri,
    /\#(?:.*;)?start=(\d+),(\d+);end=(\d+),(\d+)/
  )
  if (endc)
    return {
      start: { line: toInt(startl) - 1, character: toInt(startc) },
      end: { line: toInt(endl) - 1, character: toInt(endc) }
    }
  return
}

export interface ClientAndObject {
  confKey: string
  client: ADTClient
  obj: AbapObjectDetail
  source: string
}

export async function clientAndObjfromUrl(
  uri: string,
  withSource: boolean = true
): Promise<ClientAndObject | undefined> {
  const confKey = clientKeyFromUrl(uri)
  if (!confKey) return
  const client = await clientFromKey(confKey)
  if (!client) return
  const obj = await getObject(uri)
  if (!obj) return
  const source = withSource ? await getEditorObjectSource(uri) : ""

  return { confKey, client, obj, source }
}
