import {
  CodeActionParams,
  CodeAction,
  DiagnosticSeverity,
  Command,
  Position,
  Range,
  TextEdit
} from "vscode-languageserver"
import { clientAndObjfromUrl } from "./utilities"
import { log } from "./clientManager"
import { FixProposal, Range as ApiRange, Location } from "abap-adt-api"
import { decodeEntity } from "./functions"

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
      decodeEntity(p["adtcore:name"]),
      Command.create("fix", "abapfs.quickfix", p, uri)
    )
  )
  return actions
}
function convertLocation(loc: Location) {
  return Position.create(loc.line - 1, loc.column)
}
function convertRange(apiRange: ApiRange) {
  const { start, end } = apiRange

  return Range.create(convertLocation(start), convertLocation(end))
}

export async function resolveQuickFix(parms: {
  proposal: FixProposal
  uri: string
}) {
  const co = await clientAndObjfromUrl(parms.uri, true)
  if (!co) return
  const deltas = await co.client.fixEdits(parms.proposal, co.source)
  if (!deltas || deltas.length === 0) return

  return deltas.map(d => {
    if (d.range.start !== d.range.end)
      return TextEdit.replace(convertRange(d.range), d.content)
    else return TextEdit.insert(convertLocation(d.range.start), d.content)
  })
}
