import { window, ViewColumn, Uri } from "vscode"
import { ADTSCHEME, getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { context } from "../../extension"
import { QueryPanel } from "./queryPanel"

export async function showQuery() {
  const editor = window.activeTextEditor
  if (!editor) return
  const uri = editor.document.uri
  const sel = editor.selection.active
  if (uri.scheme !== ADTSCHEME) return
  const client = getClient(uri.authority)
  const obj = await findAbapObject(uri)

  let tablename = ""

  if (obj.type == 'DDLS/DF' || obj.type == 'TABL/DT') {
    tablename = obj.name;
  }

  QueryPanel.createOrShow(context.extensionUri, client, tablename);

}
