import { DiagnosticSeverity, TextDocument, Range } from "vscode-languageserver"
import { isString, isNumber } from "util"
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

export const memoize = <P, R>(
  base: (p: P) => Promise<R>
): ((p: P) => Promise<R>) => async (param: P) => {
  const cache: Map<P, R> = new Map()
  let result = cache.get(param)
  if (!result) {
    result = await base(param)
    cache.set(param, result)
  }
  return result
}

export function parts(whole: any, pattern: RegExp): string[] {
  if (!isString(whole)) return []
  const match = whole.match(pattern)
  return match ? match.slice(1) : []
}

export function toInt(raw: any): number {
  if (isNaN(raw)) return 0
  if (isNumber(raw)) return Math.floor(raw)
  if (!raw && !isString(raw)) return 0
  const n = Number.parseInt(raw, 10)
  if (isNaN(n)) return 0
  return n
}
