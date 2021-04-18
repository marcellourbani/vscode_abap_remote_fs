import { ADTClient, DebugAttach, Debuggee, DebugStack, DebugStackInfo, DebugStep, DebugStepType, isDebuggerBreakpoint, isDebugListenerError, session_types } from "abap-adt-api";
import { newClientFromKey, md5 } from "./functions";
import { readFileSync } from "fs";
import { createAdtUri, log } from "../../lib";
import { DebugProtocol } from "vscode-debugprotocol";
import { Disposable, EventEmitter, Uri } from "vscode";
import { getRoot } from "../conections";
import { isAbapFile, isFolder } from "abapfs";
import { homedir } from "os";
import { join } from "path";
import { Breakpoint, Source, StackFrame, StoppedEvent, TerminatedEvent } from "vscode-debugadapter";
import { vsCodeUri } from "../../langClient";

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
    private stackTrace: StackFrame[] = [];
    private breakpoints = new Map<string, Breakpoint[]>()
    public readonly THREADID = 1;

    constructor(private connId: string, private client: ADTClient, private terminalId: string, private ui: DebuggerUI) {
        this.ideId = md5(connId)
        this.username = client.username.toUpperCase()
    }
    addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
        return this.notifier.event(listener, thisArg, this.listeners)
    }

    getStack() {
        return this.stackTrace
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
                if (!this.active) return
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

    public getBreakpoints(path: string) {
        return this.breakpoints.get(path) || [];
    }
    public async setBreakpoints(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
        const bps = await this.setBreakpointsInt(source, breakpoints)
        if (source.path) this.breakpoints.set(source.path, bps)
        return bps
    }

    private async setBreakpointsInt(source: DebugProtocol.Source, breakpoints: DebugProtocol.SourceBreakpoint[]) {
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
                    if (actual) {
                        const src = new Source(source.name || "", source.path)
                        return new Breakpoint(true, bp.line, 0, src)
                    }
                    return new Breakpoint(false)
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
            await this.updateStack()
            this.notifier.fire(new StoppedEvent("breakpoint", this.THREADID))
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
        try {
            const res = await this.baseDebuggerStep(stepType, url)
            if (res.isSteppingPossible) {
                await this.updateStack()
                this.notifier.fire(new StoppedEvent("breakpoint", this.THREADID))
            }
            return res
        } catch (error) {
            if (error.properties["com.sap.adt.communicationFramework.subType"] === "debuggeeEnded") {
                this.stopDebugging()
            } else
                this.ui.ShowError(error.message)
        }
    }

    private async updateStack() {
        const stackInfo = await this.client.debuggerStackTrace().catch(() => undefined)
        const createFrame = (path: string, line: number, id: number) => {
            const name = path.replace(/.*\//, "")
            // const fullPath = createAdtUri(this.connId, path).toString()
            const source = new Source(name, path)
            const frame = new StackFrame(id, name, source, line)
            return frame
        }
        if (stackInfo) {
            const root = getRoot(this.connId)
            const stackp = stackInfo.stack.map(async (s, id) => {
                try {
                    const path = await vsCodeUri(this.connId, s.uri.uri, false, true)
                    return createFrame(path, s.line, id)
                } catch (error) {
                    log(error)
                    return createFrame("unknown", 0, id)
                }
            })
            // @ts-ignore
            this.stackTrace = (await Promise.all(stackp)).filter(s => s instanceof StackFrame)
        }
    }

    public async stopDebugging() {
        this.active = false
        await this.client.dropSession()
        this.notifier.fire(new TerminatedEvent())
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

