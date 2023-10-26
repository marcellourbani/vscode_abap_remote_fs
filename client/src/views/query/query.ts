import { window } from "vscode"
import { ADTSCHEME, abapUri, getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { context } from "../../extension"
import { QueryPanel } from "./queryPanel"
import { viewableObjecttypes } from "../../lib"
import { currentAbapFile, currentUri } from "../../commands/commands"

export async function showQuery(table?: string) {
  const uri = currentUri()
  if (!(uri && abapUri(uri))) return
  const client = getClient(uri.authority)
  if (table) QueryPanel.createOrShow(context.extensionUri, client, table)
  else {
    const obj = await findAbapObject(uri)
    const tablename = viewableObjecttypes.has(obj.type) ? obj.name : ""
    QueryPanel.createOrShow(context.extensionUri, client, tablename)
  }

}
