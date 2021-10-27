import { CancellationToken, Position, RenameParams, TextEdit, WorkspaceEdit } from "vscode-languageserver"
import { WorkDoneProgress } from "vscode-languageserver/lib/progress"
import { getVSCodeUri } from "./clientapis"
import { isAbap } from "./functions"
import { clientAndObjfromUrl } from "./utilities"

export const renameHandler = async (params: RenameParams, token: CancellationToken, workDoneProgress: WorkDoneProgress): Promise<WorkspaceEdit> => {
    const { textDocument, newName, position } = params
    const co = await clientAndObjfromUrl(textDocument.uri)
    if (!isAbap(textDocument.uri) || !co) return {}
    const renameEvaluateResult = await co.client.renameEvaluate(co.obj.mainUrl, position.line + 1, position.character, position.character)
    renameEvaluateResult.newName = newName
    const changes: Record<string, TextEdit[]> = {}
    for (const obj of renameEvaluateResult.affectedObjects) {
        const uri = await getVSCodeUri(co.confKey, obj.uri, false)
        changes[uri] = obj.textReplaceDeltas.map(d => {
            const start: Position = { line: d.rangeFragment.start.line - 1, character: d.rangeFragment.start.column }
            const end: Position = { line: d.rangeFragment.end.line - 1, character: d.rangeFragment.end.column }
            return TextEdit.replace({ start, end }, newName)
        })
    }
    return { changes }
}

