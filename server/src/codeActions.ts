import {
  CodeActionParams,
  CodeAction,
  DiagnosticSeverity,
  Command
} from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { log } from "./clientManager"
import { FixProposal } from "abap-adt-api"
import { decode } from "html-entities"

export async function codeActionHandler(
  parms: CodeActionParams
): Promise<CodeAction[] | undefined> {
  if (!parms.context.diagnostics.length) return
  return quickfix(parms)
}
const shouldAdd = (newProposal: FixProposal, existing: FixProposal[]) => {
  const propType = newProposal["adtcore:type"]
  if (propType.match(/dialog|rename_quickfix/i)) return false
  return !existing.find(
    a =>
      a["adtcore:uri"] === newProposal["adtcore:uri"] &&
      a["adtcore:name"] === newProposal["adtcore:name"] &&
      a["adtcore:type"] === newProposal["adtcore:type"] &&
      a.uri === newProposal.uri &&
      a.line === newProposal.line &&
      a.column === newProposal.column
  )
}
async function quickfix(
  parms: CodeActionParams
): Promise<CodeAction[] | undefined> {
  try {

    const diag = parms.context.diagnostics
    const uri = parms.textDocument.uri
    let co
    const allProposals: FixProposal[] = []
    for (const d of diag)
      if (
        d.severity === DiagnosticSeverity.Error ||
        d.severity === DiagnosticSeverity.Warning
      ) {
        if (!co) co = await clientAndObjfromUrl(parms.textDocument.uri, true)
        if (!co || !co.client) return
        try {
          const proposals = await co.client.fixProposals(
            co.obj.mainUrl,
            co.source,
            d.range.start.line + 1,
            d.range.start.character
          )
          for (const p of proposals)
            if (shouldAdd(p, allProposals)) allProposals.push(p)
        } catch (e) {
          log(e)
        }
      }
    const actions = allProposals.map(p =>
      CodeAction.create(
        decode(p["adtcore:name"]),
        Command.create("fix", "abapfs.quickfix", p, uri)
      )
    )
    return actions
  } catch (error) {
    log(error)
    return []
  }

}
