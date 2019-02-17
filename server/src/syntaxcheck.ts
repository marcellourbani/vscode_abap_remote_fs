import { clientFromUrl, connection, log } from "./clientManager"
import { objectIsValid } from "sharedtypes"
import { TextDocument, Diagnostic } from "vscode-languageserver"
import { getObject } from "./objectManager"
import { sourceRange, decodeSeverity } from "./utilities"

export async function syntaxCheck(document: TextDocument) {
  const diagnostics: Diagnostic[] = []
  try {
    const client = await clientFromUrl(document.uri)
    if (!client) return
    const obj = await getObject(document.uri)
    // no object or include without a main program
    if (!obj || !objectIsValid(obj)) return

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
