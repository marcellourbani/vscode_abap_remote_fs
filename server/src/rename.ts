import { CancellationToken, RenameParams, WorkspaceEdit } from "vscode-languageserver"
import { WorkDoneProgress } from "vscode-languageserver/lib/progress"
import { log } from "./clientManager"
import { isAbap } from "./functions"
import { clientAndObjfromUrl } from "./utilities"

export const renameHandler = async (params: RenameParams, token: CancellationToken, workDoneProgress: WorkDoneProgress): Promise<WorkspaceEdit> => {
    const { textDocument, newName, position } = params
    const co = await clientAndObjfromUrl(textDocument.uri)
    if (!isAbap(textDocument.uri) || !co) return {}
    const renameEvaluateResult = await co.client.renameEvaluate(co.obj.mainUrl, position.line + 1, position.character, position.character)
    const transport = "" //TODO: transport resolution
    renameEvaluateResult.newName = newName
    renameEvaluateResult.affectedObjects.forEach(obj => {
        obj.textReplaceDeltas.forEach(delta => {
            delta.contentNew = newName
            delta.contentOld = renameEvaluateResult.oldName
        })
    })
    const renameProposals = await co.client.renamePreview(renameEvaluateResult, transport)
    log(renameProposals)
    return {}
}

