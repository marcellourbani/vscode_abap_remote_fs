import { Command, Uri, commands, window, workspace } from "vscode"
import { getClient } from "../../adt/conections"
import { AbapFsCommands, command } from "../../commands"
import { convertRun } from "./convertProfile"
import { TraceRunItem } from "./views"
import { ADTPROFILE, adtProfileUri } from "./documentprovider"
import { TraceRun } from "abap-adt-api/build/api/tracetypes"


export class Commands {

    @command(AbapFsCommands.openTrace)
    private async openTrace(item: TraceRunItem) {
        const client = getClient(item.connId)
        const detailed = !item.run.extendedData.isAggregated
        const hitlist = await client.tracesHitList(item.run.id)
        const profile = convertRun(item.run, hitlist)
        const statements = detailed && await client.tracesStatements(item.run.id)
        const dbaccesses = await client.tracesDbAccess(item.run.id)
        console.log(item, statements, dbaccesses, hitlist, profile)
        const uri = adtProfileUri(item)
        commands.executeCommand("vscode.openWith", uri, "jsProfileVisualizer.cpuprofile.table")
    }

}

export const openCommand = (run: TraceRunItem): Command => ({ title: "Open", command: AbapFsCommands.openTrace, arguments: [run] })