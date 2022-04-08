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

const jsHeader = `<script type="text/javascript">
const vscode = acquireVsCodeApi();
function abapClick(uri) {
    vscode.postMessage({
        command: 'click',
        uri: uri
    });
};
</script>`

export const injectUrlHandler = (x: string) => {
    const fixed = x.replace(/href\s*=\s*("[^"]*")/gi, "onClick='abapClick($1)'")
        .replace(/href\s*=\s*('[^']*')/gi, 'onClick="abapClick($1)"')
    if (fixed.match(/<head>/i)) return fixed.replace(/<head>/i, `<head>${jsHeader}`)
    return `<head>${jsHeader}</head>${fixed}`
}