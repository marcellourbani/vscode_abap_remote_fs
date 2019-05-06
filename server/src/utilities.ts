import { DiagnosticSeverity, TextDocument, Range } from "vscode-languageserver"
import { isString, isNumber } from "util"
import { ADTClient } from "abap-adt-api"
import { AbapObjectDetail } from "vscode-abap-remote-fs-sharedapi"
import { clientKeyFromUrl, clientFromKey } from "./clientManager"
import { getObject } from "./objectManager"
import { getEditorObjectSource } from "./clientapis"
import { AllHtmlEntities } from "html-entities"

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
    const lastwordm = lineText.substr(0, character).match(/(<?[\w]+>?)$/)
    const start = { line, character }
    if (lastwordm) start.character -= lastwordm[1].length
    const end = { line, character: character + 1000 }
    const match = lineText.substr(start.character).match(/^(<?[\w]+>?)/)
    end.character = start.character + (match ? match[1].length : 1)
    return { start, end }
  } else {
    const start = { line, character }
    const end = { line, character: character + 1000 }
    const match = document.getText({ start, end }).match(/^(<?[\w]+>?)/)
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

export const memoize = <P, R>(
  base: (p: P) => Promise<R>
): ((p: P) => Promise<R>) => {
  const cache: Map<P, R> = new Map()
  return async (param: P) => {
    let result = cache.get(param)
    if (!result) {
      result = await base(param)
      cache.set(param, result)
    }
    return result
  }
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

export const [decodeEntity, encodeEntity] = (() => {
  let entities: AllHtmlEntities | undefined
  return [
    (s: string) => {
      if (!entities) entities = new AllHtmlEntities()
      return entities.decode(s)
    },
    (s: string) => {
      if (!entities) entities = new AllHtmlEntities()
      return entities.encode(s)
    }
  ]
})()

export const hashParms = (uri: string): any => {
  const parms: any = {}
  const hash = uri.split(/#/)[1]
  const uriHashArgs: string[] = (hash && hash.split(/;/)) || []
  for (const arg of uriHashArgs) {
    const argTuple = arg.split(/=/, 2)
    if (argTuple.length > 1)
      parms[argTuple[0]] = decodeURIComponent(argTuple[1])
  }
  return parms
}
