import { DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, window } from "vscode"
import { log } from "../../lib"
import { AbapDebugSession, AbapDebugSessionCfg } from "./abapDebugSession"
import { DebugListener } from "./debugListener"
import { DebuggerUI } from "./debugService"

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
                await old.logOut()
            } else abort()
        }
        const listener = await DebugListener.create(connId, ui, debugUser, terminalMode)
        const abapSession = new AbapDebugSession(connId, listener)
        this.loggedinSessions.push(abapSession)
        abapSession.onClose(() => this.sessionClosed(abapSession))
        log(`Debug session started for ${connId}, ${this.loggedinSessions.length} active sessions`)
        return new DebugAdapterInlineImplementation(abapSession)
    }

    sessionClosed(session: AbapDebugSession) {
        this.loggedinSessions = this.loggedinSessions.filter(s => s !== session)
    }

    closeSessions() {
        return this.loggedinSessions.flatMap(s => s.logOut())
    }

    static get instance() {
        if (!this._instance) {
            this._instance = new AbapDebugAdapterFactory()
        }
        return this._instance
    }
}
