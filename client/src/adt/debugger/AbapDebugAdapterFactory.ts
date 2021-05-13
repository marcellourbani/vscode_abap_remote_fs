import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, window } from "vscode"
import { AbapDebugSession, AbapDebugSessionCfg } from "./abapDebugSession"
import { DebuggerUI, DebugService } from "./debugService"

const ui: DebuggerUI = {
    Confirmator: (message: string) => window.showErrorMessage(message, "YES", "NO").then(x => x === "YES"),
    ShowError: (message: string) => window.showErrorMessage(message)
}

export class AbapDebugAdapterFactory implements DebugAdapterDescriptorFactory {
    private static _instance: AbapDebugAdapterFactory
    private loggedinSessions: AbapDebugSession[] = []

    private constructor() { }

    async createDebugAdapterDescriptor(session: AbapDebugSessionCfg): Promise<DebugAdapterDescriptor | undefined> {
        const { connId, debugUser, terminalMode } = session.configuration
        const old = AbapDebugSession.byConnection(connId)
        if (old) {
            const abort = () => { throw new Error("ABAP Debug starting aborted") }
            const resp = await window.showInformationMessage("Debug session already running, terminate and replace?", "Yes", "No")
            if (resp === "Yes") {
                await old.logOut(true)// .then(() => after(1000))
            } else abort()
        }
        const service = await DebugService.create(connId, ui, debugUser, terminalMode)
        const abapSession = new AbapDebugSession(connId, service)
        this.loggedinSessions.push(abapSession)
        return new DebugAdapterInlineImplementation(abapSession)
    }

    sessionClosed(session: AbapDebugSession) {
        this.loggedinSessions = this.loggedinSessions.filter(s => s !== session)
    }

    closeSessions() {
        return this.loggedinSessions.map(s => s.logOut())
    }

    static get instance() {
        if (!this._instance) {
            this._instance = new AbapDebugAdapterFactory()
        }
        return this._instance
    }
}
