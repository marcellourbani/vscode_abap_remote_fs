import { Command, Uri, commands } from "vscode"
import { AbapFsCommands, command } from "../../commands"
import { TraceRunItem, TraceView, tracesProvider } from "./views"
import { adtProfileUri } from "./fsProvider"
import { getOrCreateClient } from "../../adt/conections"


export class Commands {

    @command(AbapFsCommands.refreshTraces)
    private async openTrace(view: TraceView) {
        if (view.contextValue === "configfolder" || view.contextValue === "runfolder" || view.contextValue === "system")
            tracesProvider.emitter.fire(view)
    }

    @command(AbapFsCommands.deleteTrace)
    private async deleteTraces(item: TraceView) {
        if (item.contextValue === "run") {
            const client = await getOrCreateClient(item.connId)
            await client.tracesDelete(item.run.id)
            tracesProvider.emitter.fire(tracesProvider.root(item.connId)?.runs)
        }
        if (item.contextValue === "configuration") {
            const client = await getOrCreateClient(item.connId)
            await client.tracesDeleteConfiguration(item.config.id)
            tracesProvider.emitter.fire(tracesProvider.root(item.connId)?.configs)
        }

    }

}

export const openCommand = (uri: Uri): Command => ({ title: "Open", command: "vscode.open", arguments: [uri] })