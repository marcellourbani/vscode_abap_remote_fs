import { AtcProposal } from "abap-adt-api"
import { commands, Position, ProgressLocation, QuickPickOptions, Selection, Uri, window, workspace, WorkspaceEdit } from "vscode"
import { getClient } from "../../adt/conections"
import { RemoteManager } from "../../config"
import { chainTaskTransformers, fieldReplacer, inputBox, quickPick, rfsExtract, RfsTaskEither, rfsTryCatch, showErrorMessage } from "../../lib"
import { ATCDocumentation } from "./documentation"
import { AtcFind, AtcNode, AtcObject, atcProvider, AtcRoot, AtcSystem } from "./view"
import { findingPragmas } from "./codeinspector"
import { AbapFsCommands, command } from "../../commands"
import { insertPosition } from "./functions"
const openLocation = async (finding?: AtcFind) => {
    try {
        if (!finding) return
        const uriP = Uri.parse(finding.uri)
        const document = await workspace.openTextDocument(uriP)
        const selection = new Selection(finding.start, finding.start)
        await window.showTextDocument(document, { preserveFocus: false, selection })
    } catch (error) {
        showErrorMessage(error)
    }
}

const tryIgnoreFinfing = async (finding?: AtcFind) => {
    const pos = finding?.start
    if (!pos) {
        window.showInformationMessage(`Position information is missing.`)
        return
    }
    const pragmas = await findingPragmas(finding.parent.parent.connectionId, finding.finding)
    if (!pragmas.length) {
        window.showInformationMessage(`Can't find a pragma or pseudocomment`)
        return
    }
    const pragma = pragmas.length === 1 ? pragmas[0] : rfsExtract(await quickPick(pragmas, { placeHolder: "Select override" })())
    if (!pragma) return
    const uriP = Uri.parse(finding.uri)
    const document = await workspace.openTextDocument(uriP)
    const lines = document.getText().split("\n")
    const line = lines[pos.line] || ""
    if (line.includes(pragma.replace(/^"/, ""))) {
        window.showInformationMessage(`Pragma or pseudocomment ${pragma} already included`)
        return
    }
    const selection = pos && new Selection(pos, pos)
    const edit = new WorkspaceEdit()
    edit.insert(uriP, new Position(pos.line, insertPosition(line, pragma)), ` ${pragma}`)
    workspace.applyEdit(edit)
    await window.showTextDocument(document, { preserveFocus: false, selection })
}
const selectors = (connId: string) => ({
    inputJustification: fieldReplacer("justification", inputBox({ prompt: "Justification" })),
    inputReason: fieldReplacer("reason", quickPick(
        [{ label: "False Positive", value: "FPOS" }, { label: "Other", value: "OTHR" }],
        { placeHolder: "Select Reason" }, x => x.value)),
    notifyOn: fieldReplacer("notify", quickPick(
        [{ label: "On rejection", value: "on_rejection" }, { label: "Always", value: "always" }, { label: "Never", value: "never" }],
        { placeHolder: "Select Reason" }, x => x.value)),
    approver: (value?: string) => fieldReplacer("approver", inputBox({ prompt: "Enter approver user ID", value })),
})
const requestExemption = async (item: AtcFind) => {
    try {
        const client = getClient(item.parent.parent.connectionId)
        const aapprover = RemoteManager.get().byId(item.parent.parent.connectionId)?.atcapprover
        if (!item.finding.quickfixInfo) throw new Error("No info available - exemption requested?")
        const proposal = await client.atcExemptProposal(item.finding.quickfixInfo)
        if (client.isProposalMessage(proposal)) throw new Error("Exemption proposal expected")
        proposal.restriction.enabled = true
        proposal.restriction.singlefinding = true
        const { inputReason, approver, notifyOn, inputJustification } = selectors(item.parent.parent.connectionId)
        const actualResult = await chainTaskTransformers<AtcProposal>(inputReason, approver(aapprover), notifyOn, inputJustification)(proposal)()
        const actual = rfsExtract(actualResult)
        if (!actual) return
        await client.atcRequestExemption(actual)
        await item.parent.parent.refresh()
    } catch (error) {
        showErrorMessage(error)
    }
}
const selectKey = <K extends string, T extends Record<K, boolean>>(keys: K[], r: T, options: QuickPickOptions): RfsTaskEither<K> => {
    keys.filter(k => r[k])
    if (keys.length <= 1) return rfsTryCatch(async () => keys[0])
    return quickPick(keys, options)
}

const requestExemptionAll = async (item: AtcFind) => {
    try {
        const client = getClient(item.parent.parent.connectionId)
        if (!item.finding.quickfixInfo) throw new Error("No info available - exemption requested?")
        const proposal = await client.atcExemptProposal(item.finding.quickfixInfo)
        if (client.isProposalMessage(proposal)) throw new Error("Exemption proposal expected")
        proposal.restriction.enabled = true
        proposal.restriction.singlefinding = false
        const { inputReason, approver, notifyOn, inputJustification } = selectors(item.parent.parent.connectionId)
        const target = rfsExtract(await selectKey(["object", "package", "subobject"],
            proposal.restriction.rangeOfFindings.restrictByObject,
            { placeHolder: "Select target object" })())
        if (!target) return
        proposal.restriction.rangeOfFindings.restrictByObject.target = target
        const targetmsg = rfsExtract(await selectKey(["check", "message"],
            proposal.restriction.rangeOfFindings.restrictByCheck,
            { placeHolder: "Select target object" })())
        if (!targetmsg) return
        proposal.restriction.rangeOfFindings.restrictByCheck.target = targetmsg
        const aapprover = RemoteManager.get().byId(item.parent.parent.connectionId)?.atcapprover
        const actualResult = await chainTaskTransformers<AtcProposal>(inputReason, approver(aapprover), notifyOn, inputJustification)(proposal)()
        const actual = rfsExtract(actualResult)
        if (!actual) return
        await client.atcRequestExemption(actual)
        await item.parent.parent.refresh()
    } catch (error) {
        showErrorMessage(error)
    }
}

const showDocumentation = async (item: AtcFind) => {
    try {
        const connId = item.parent.parent.connectionId
        const url = item.finding.link.href
        await ATCDocumentation.get().showDocumentation({ connId, url })
        commands.executeCommand("abapfs.views.atcdocs.focus")
    } catch (error) {
        showErrorMessage(error)
    }
}

export const atcRefresh = async (item?: AtcNode) => {
    try {
        await window.withProgress(
            { location: ProgressLocation.Window, title: `Refreshing ABAP Test cockpit` },
            async () => {
                if (item instanceof AtcSystem) {
                    return item.refresh()
                }
                if (item instanceof AtcObject) {
                    return item.parent.refresh()
                }
                if (item instanceof AtcFind) {
                    return item.parent.parent.refresh()
                }
                if (item instanceof AtcRoot) {
                    return Promise.all(item.children.map(i => i.refresh()))
                }
                if (!item) {
                    return Promise.all(atcProvider.root.children.map(i => i.refresh()))
                }
            }
        )
    } catch (e) {
        showErrorMessage(e)
    }
}

class Commands {

    @command(AbapFsCommands.openLocation)
    private async OpenLocation(finding?: AtcFind) {
        openLocation(finding)
    }

    @command(AbapFsCommands.atcIgnore)
    private async tryIgnoreFinfing(finding?: AtcFind) {
        return tryIgnoreFinfing(finding)
    }
    @command(AbapFsCommands.atcAutoRefreshOn)
    private async autoRefreshOn() {
        atcProvider.setAutoRefresh(true)
    }
    @command(AbapFsCommands.atcAutoRefreshOff)
    private async autoRefreshOff() {
        atcProvider.setAutoRefresh(false)
    }
    @command(AbapFsCommands.atcFilterExemptOn)
    private async exemptFilterOn() {
        atcProvider.setExemptFilter(true)
    }
    @command(AbapFsCommands.atcFilterExemptOff)
    private async exemptFilterOff() {
        atcProvider.setExemptFilter(false)
    }
    @command(AbapFsCommands.atcRequestExemption)
    private async RequestExemption(item: AtcFind) {
        return requestExemption(item)
    }
    @command(AbapFsCommands.atcRefresh)
    private async atcRefresh(item?: AtcNode) {
        atcRefresh(item)
    }

    @command(AbapFsCommands.atcRequestExemptionAll)
    private async RequestExemptionAll(item: AtcFind) {
        return requestExemptionAll(item)
    }
    @command(AbapFsCommands.atcShowDocumentation)
    private async ShowDocumentation(item: AtcFind) {
        return showDocumentation(item)
    }

}
