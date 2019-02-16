import { clientFromUrl, connection, log } from "./clientManager"
import { objectIsValid } from "sharedtypes"
import {
  TextDocument,
  Diagnostic,
  DiagnosticSeverity,
  Range
} from "vscode-languageserver"
import { getObject } from "./objectManager"

function decodeSeverity(severity: string) {
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
  document: TextDocument,
  line: number,
  character: number
): Range {
  const start = { line: line - 1, character }
  const end = { line: line - 1, character: character + 1000 }
  const part = document.getText({ start, end })
  const match = part.match(/^([\w]+)/)
  end.character = start.character + (match ? match[1].length : 1)
  return { start, end }
}

export async function syntaxCheck(document: TextDocument) {
  const client = await clientFromUrl(document.uri)
  if (!client) return
  const obj = await getObject(document.uri)
  // no object or include without a main program
  if (!obj || !objectIsValid(obj)) return

  const diagnostics: Diagnostic[] = []
  try {
    const source = document.getText()
    const checks = await client.syntaxCheck(
      obj.url,
      obj.mainUrl,
      source,
      obj.mainProgram
    )
    checks.forEach(c => {
      const range = sourceRange(document, c.line, c.offset)
      diagnostics.push({
        message: c.text,
        range,
        severity: decodeSeverity(c.severity)
      })
    })
  } catch (e) {
    log(e)
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics })
}
