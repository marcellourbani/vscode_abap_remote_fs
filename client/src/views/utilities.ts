import { SystemUser } from "abap-adt-api"
import { window } from "vscode"
import { getClient } from "../adt/conections"

export async function pickUser(connId: string, placeHolder = "Select user"): Promise<SystemUser | undefined> {
    const users = (await getClient(connId).systemUsers()).map(u => ({
        label: u.title,
        description: u.id,
        payload: u
    }))
    const selected = await window.showQuickPick(users, { ignoreFocusOut: true, placeHolder })
    return selected?.payload
}