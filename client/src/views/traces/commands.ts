import { getClient } from "../../adt/conections"
import { AbapFsCommands, command } from "../../commands"
import { Run } from "./views"


export class Commands {

    @command(AbapFsCommands.openTrace)
    private async trace(item: Run) {
        const client = getClient(item.connId)
        const detailed = !item.run.extendedData.isAggregated
        const hitlist = await client.tracesHitList(item.run.id)
        const statements = detailed && await client.tracesStatements(item.run.id)
        const dbaccesses = await client.tracesDbAccess(item.run.id)
        console.log(item, statements, dbaccesses, hitlist)
    }

}