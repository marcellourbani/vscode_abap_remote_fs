import { Command, Uri, commands, window, workspace } from "vscode"
import { getClient } from "../../adt/conections"
import { AbapFsCommands, command } from "../../commands"
import { convertRun } from "./convertProfile"
import { TraceRunItem } from "./views"
import { adtProfileUri } from "./fsProvider"


export class Commands {

    @command(AbapFsCommands.openTrace)
    private async openTrace(item: TraceRunItem) {
        const uri = adtProfileUri(item)
        await commands.executeCommand("vscode.open", uri)
    }

}

export const openCommand = (run: TraceRunItem): Command => ({ title: "Open", command: AbapFsCommands.openTrace, arguments: [run] })