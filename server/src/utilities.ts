import { DiagnosticSeverity, TextDocument, Range } from "vscode-languageserver"
import { isString } from "util"
import { ADTClient } from "abap-adt-api"
import { AbapObjectDetail } from "sharedtypes"
import { clientKeyFromUrl, clientFromKey } from "./clientManager"
import { getObject } from "./objectManager"
import { getObjectSource } from "./clientapis"

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
  line: number,
  character: number
): Range {
  const getpart = () => {
    if (!isString(document)) return document.getText({ start, end })
    const lines = document.split("\n")
    return ((lines && lines[line - 1]) || "").substr(character)
  }
  const start = { line: line - 1, character }
  const end = { line: line - 1, character: character + 1000 }
  const match = getpart().match(/^([\w]+)/)
  end.character = start.character + (match ? match[1].length : 1)
  return { start, end }
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
  const source = withSource ? await getObjectSource(uri) : ""

  return { confKey, client, obj, source }
}
