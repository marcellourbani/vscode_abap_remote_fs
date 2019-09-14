import { TextEdit, DocumentFormattingParams } from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { isString } from "util"
import { isAbap } from "./functions"

export async function formatDocument(params: DocumentFormattingParams) {
  if (!isAbap(params.textDocument.uri)) return
  const edits: TextEdit[] = []
  const co = await clientAndObjfromUrl(params.textDocument.uri, true)
  if (co) {
    const newText = await co.client.prettyPrinter(co.source)
    if (isString(newText) && newText) {
      const diff = Math.abs(newText.length - co.source.length) / newText.length
      // sanity check: if length changed more than 20% ingore
      if (diff <= 0.2) {
        const lines = co.source.split(/\n/)
        const character = lines[lines.length - 1].length
        edits.push({
          range: {
            start: { line: 0, character: 0 },
            end: {
              line: lines.length,
              character
            }
          },
          newText
        })
      }
    }
  }
  return edits
}
