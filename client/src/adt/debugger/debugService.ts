import { ADTClient, DebugAttach, Debuggee, DebugStep, DebugStepType, isDebuggerBreakpoint, isDebugListenerError, session_types } from "abap-adt-api";
import { newClientFromKey, md5 } from "./functions";
import { readFileSync } from "fs";
import { log } from "../../lib";
import { DebugProtocol } from "vscode-debugprotocol";
import { Disposable, EventEmitter, Uri } from "vscode";
import { getRoot } from "../conections";
import { isAbapFile } from "abapfs";
import { homedir } from "os";
import { join } from "path";
import { StoppedEvent, TerminatedEvent } from "vscode-debugadapter";

let breakpointId = 1

export interface DebuggerUI {
    Confirmator: (message: string) => Thenable<boolean>
    ShowError: (message: string) => any
}

export class DebugService {
    private active: boolean = false;
    private listening = false
    private ideId: string;
    private username: string
    private notifier: EventEmitter<DebugProtocol.Event> = new EventEmitter()
    private listeners: Disposable[] = []

    addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
        return this.notifier.event(listener, thisArg, this.listeners)
    }

    constructor(private connId: string, private client: ADTClient, private terminalId: string, private ui: DebuggerUI) {
        this.ideId = md5(connId)
        this.username = client.username.toUpperCase()
    }

    public static async create(connId: string, ui: DebuggerUI) {
        const client = await newClientFromKey(connId)
        if (!client) throw new Error(`Unable to create client for${connId}`);
        client.stateful = session_types.stateful
        await client.adtCoreDiscovery()
        const cfgfile = join(homedir(), ".SAP/ABAPDebugging/terminalId")
        const terminalId = readFileSync(cfgfile).toString("utf8")// "71999B60AA6349CF91D0A23773B3C728"
        return new DebugService(connId, client, terminalId, ui)
    }

    public async mainLoop() {
        this.active = true
        while (this.active) {
            try {
                // const foo = await this.client.statelessClone.debuggerListeners("user", this.terminalId, this.ideId, this.username)
                // log(JSON.stringify(foo))
                this.listening = true
                const debuggee = await this.client.statelessClone.debuggerListen("user", this.terminalId, this.ideId, this.username)
                    .finally(() => this.listening = false)
                if (!debuggee) continue
                if (isDebugListenerError(debuggee)) {
                    // reconnect
                    break
                }
                await this.onBreakpointReached(debuggee)
            } catch (error) {
                if (error.properties["com.sap.adt.communicationFramework.subType"]) {
                    const txt = error?.properties?.conflictText || "Debugger conflict detected"
                    const message = `${txt} Take over debugging?`
                    // const resp = await window.showQuickPick(["YES", "NO"], { placeHolder })
                    const resp = await this.ui.Confirmator(message)
                    if (resp)
                        try {
                            await this.client.statelessClone.debuggerDeleteListener("user", this.terminalId, this.ideId, this.username)
                        } catch (error2) {
                            log(JSON.stringify(error2))
                        }
                    else {
                        this.notifier.fire(new TerminatedEvent(false))
                        this.active = false
                    }
                }
                else {
                    this.ui.ShowError(`Error listening to debugger: ${error.message || error}`)
                    this.notifier.fire(new TerminatedEvent(false))
                    this.active = false
                }
            }
        }
    }

    public async setBreakpoints(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
        breakpoints ||= []
        if (!source.path) return []
        const uri = Uri.parse(source.path)
        const root = getRoot(this.connId)
        const node = await root.getNodeAsync(uri.path)
        if (isAbapFile(node)) {
            const objuri = node.object.contentsPath()
            const clientId = `24:${this.connId}${uri.path}` // `582:/A4H_001_developer_en/.adt/programs/programs/ztest/ztest.asprog`
            const bps = breakpoints.map(b => `${objuri}#start=${b.line}`)
            try {
                const actualbps = await this.client.statelessClone.debuggerSetBreakpoints(
                    "user", this.terminalId, this.ideId, clientId, bps, this.username)
                return breakpoints.map(bp => {
                    const actual = actualbps.find(a => isDebuggerBreakpoint(a) && a.uri.range.start.line === bp.line)
                    if (actual) return {
                        verified: true,
                        id: breakpointId++,
                        line: bp.line,
                        source: { ...source, adapterData: actual }
                    }
                    return { verified: false }
                })
            } catch (error) {
                log(error.message)
            }
        }
        return []

    }

    private async onBreakpointReached(debuggee: Debuggee) {
        try {
            const attach = await this.client.debuggerAttach("user", debuggee.DEBUGGEE_ID, this.username, true)
            const bp = attach.reachedBreakpoints[0]
            this.notifier.fire(new StoppedEvent("breakpoint reached"))
            log(JSON.stringify(bp))
            const stack = await this.client.debuggerStackTrace()
            log(JSON.stringify(stack))
            const variables = await this.client.debuggerVariables(["SY-SUBRC", "SY"])
            log(JSON.stringify(variables))
            const cvariables = await this.client.debuggerChildVariables()
            log(JSON.stringify(cvariables))
            await this.client.debuggerStep("stepContinue")
        } catch (error) {
            log(`${error}`)
            this.stopDebugging()
        }
    }

    private async baseDebuggerStep(stepType: DebugStepType, url?: string) {
        if (stepType === "stepRunToLine" || stepType === "stepJumpToLine") {
            if (!url) throw new Error(`Bebugger step${stepType} requires a target`)
            return this.client.debuggerStep(stepType, url)
        }
        return this.client.debuggerStep(stepType)

    }

    public async debuggerStep(stepType: DebugStepType, url?: string) {
        const res = await this.baseDebuggerStep(stepType, url)
        if (res.reachedBreakpoints?.length) await this.updateDebugState(res)
        return res
    }
    private async updateDebugState(state: DebugStep | DebugAttach) {
        const bp = state.reachedBreakpoints?.[0]
        if (!bp) return
        const stack = await this.client.debuggerStackTrace()
        log(JSON.stringify(stack))
        const variables = await this.client.debuggerVariables(["SY-SUBRC", "SY"])
        log(JSON.stringify(variables))
        const cvariables = await this.client.debuggerChildVariables()
        log(JSON.stringify(cvariables))
    }

    public async stopDebugging() {
        this.active = false
        await this.client.dropSession()
        if (this.listening)
            await this.client.statelessClone.debuggerDeleteListener("user", this.terminalId, this.ideId, this.username)
    }
    public async logout() {
        this.active = false
        if (this.listening)
            await this.client.debuggerDeleteListener("user", this.terminalId, this.ideId, this.username)
        const ignore = () => undefined
        if (this.client.loggedin) {
            return this.client.logout().catch(ignore)
        }
    }
}

