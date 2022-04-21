import { ADTClient, Debuggee, isDebugListenerError, DebuggingMode, isAdtError } from "abap-adt-api"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { log, caughtToString, ignore, isUnDefined, firstInMap } from "../../lib"
import { DebugProtocol } from "vscode-debugprotocol"
import { Disposable, EventEmitter } from "vscode"
import { getOrCreateClient } from "../conections"
import { homedir } from "os"
import { join } from "path"
import { StoppedEvent, TerminatedEvent, ThreadEvent } from "vscode-debugadapter"
import { v1 } from "uuid"
import { getWinRegistryReader } from "./winregistry"
import { context } from "../../extension"
import { DebugService } from "./debugService"
import { BreakpointManager } from "./breakpointManager"
import { VariableManager } from "./variableManager"

type ConflictResult = { with: "none" } | { with: "other" | "myself", message?: string }

const ATTACHTIMEOUT = "autoAttachTimeout"
const sessionNumbers = new Map<string, number>()

export const THREAD_EXITED = "exited"

export interface DebuggerUI {
    Confirmator: (message: string) => Thenable<boolean>
    ShowError: (message: string) => any
}

const getOrCreateIdeId = (): string => {
    const ideId = context.workspaceState.get("adt.ideId")
    if (typeof ideId === "string") return ideId
    const newIdeId = v1().replace(/-/g, "").toUpperCase()
    context.workspaceState.update("adt.ideId", newIdeId)
    return newIdeId
}

const getOrCreateTerminalId = async () => {
    if (process.platform === "win32") {
        const reg = getWinRegistryReader()
        const terminalId = reg && reg("HKEY_CURRENT_USER", "Software\\SAP\\ABAP Debugging", "TerminalID")
        if (!terminalId) throw new Error("Unable to read terminal ID from windows registry")
        return terminalId
    } else {
        const cfgpath = join(homedir(), ".SAP/ABAPDebugging")
        const cfgfile = join(cfgpath, "terminalId")
        try {
            return readFileSync(cfgfile).toString("utf8")
        } catch (error) {
            const terminalId = v1().replace(/-/g, "").toUpperCase()
            if (!existsSync(cfgpath)) mkdirSync(cfgpath, { recursive: true })
            writeFileSync(cfgfile, terminalId)
            return terminalId
        }
    }
}

const errorType = (err: any): string | undefined => {
    try {
        const exceptionType = err?.properties?.["com.sap.adt.communicationFramework.subType"]
        if (!exceptionType && `${err.response.body}`.match(/Connection timed out/)) return ATTACHTIMEOUT
        return exceptionType
    } catch (error) {/**/ }
}

const isConflictError = (e: any) => (errorType(e) || "").match(/conflictNotification|conflictDetected/)

export class DebugListener {
    readonly ideId: string
    private active: boolean = false
    private killed = false
    private notifier: EventEmitter<DebugProtocol.Event> = new EventEmitter()
    private listeners: Disposable[] = []
    readonly mode: DebuggingMode
    readonly breakpointManager
    readonly variableManager
    sessionNumber: number
    private services = new Map<number, DebugService>()
    listening = false
    private currentThreadId?: number
    private threadCreation?: Promise<void>

    public get client() {
        if (this.killed) throw new Error("Disconnected")
        return this._client
    }

    activeServices() {
        return [...this.services]
    }


    constructor(readonly connId: string, private _client: ADTClient, readonly terminalId: string,
        readonly username: string, terminalMode: boolean, private ui: DebuggerUI) {
        this.sessionNumber = (sessionNumbers.get(connId) || 0) + 1
        sessionNumbers.set(connId, this.sessionNumber)
        this.ideId = getOrCreateIdeId()
        this.mode = terminalMode ? "terminal" : "user"
        if (!this.username) this.username = _client.username.toUpperCase()
        this.breakpointManager = new BreakpointManager(this)
        this.variableManager = new VariableManager(this)
    }

    public static async create(connId: string, ui: DebuggerUI, username: string, terminalMode: boolean) {
        const client = await getOrCreateClient(connId)
        if (!client) throw new Error(`Unable to get client for${connId}`)
        const terminalId = await getOrCreateTerminalId()
        return new DebugListener(connId, client, terminalId, username, terminalMode, ui)
    }

    addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
        return this.notifier.event(listener, thisArg, this.listeners)
    }

    service(threadid: number): DebugService {
        const service = this.services.get(threadid)
        if (!service) throw new Error(`No service for threadid ${threadid}`)
        this.currentThreadId = threadid
        return service
    }
    async currentservice() {
        await this.threadCreation
        return this.service(this.currentThreadId || 0)
    }
    hasService(threadid: number): boolean {
        return this.services.has(threadid)
    }

    private async stopListener(norestart = true) {
        if (norestart) {
            this.active = false
        }
        const c = this._client.statelessClone
        return c.debuggerDeleteListener(this.mode, this.terminalId, this.ideId, this.username)
    }

    private debuggerListen() {
        try {
            this.listening = true
            return this.client.statelessClone.debuggerListen(this.mode, this.terminalId, this.ideId, this.username)
        } finally {
            this.listening = false
        }
    }

    private async hasConflict(): Promise<ConflictResult> {
        try {
            await this.client.debuggerListeners(this.mode, this.terminalId, this.ideId, this.username)
        } catch (error: any) {
            if (isConflictError(error)) return { with: "other", message: error?.properties?.conflictText }
            throw error
        }
        try {
            await this.client.debuggerListeners(this.mode, this.terminalId, "", this.username)
        } catch (error: any) {
            if (isConflictError(error)) return { with: "myself", message: error?.properties?.conflictText }
            throw error
        }
        return { with: "none" }
    }

    public async fireMainLoop(): Promise<boolean> {
        try {
            const conflict = await this.hasConflict()
            switch (conflict.with) {
                case "myself":
                    await this.stopListener()
                    this.mainLoop()
                    return true
                case "other":
                    const resp = await this.ui.Confirmator(`${conflict.message || "Debugger conflict detected"} Take over debugging?`)
                    if (resp) {
                        await this.stopListener(false)
                        this.mainLoop()
                        return true
                    }
                    return false
                case "none":
                    this.mainLoop()
                    return true
            }
        } catch (error) {
            this.ui.ShowError(`Error listening to debugger: ${caughtToString(error)}`)
            return false
        }

    }

    private async mainLoop() {
        this.active = true
        let startTime = 0
        while (this.active) {
            try {
                log(`Debugger ${this.sessionNumber} listening on connection  ${this.connId}`)
                startTime = new Date().getTime()
                const debuggee = await this.debuggerListen()
                if (!debuggee || !this.active) continue
                log(`Debugger ${this.sessionNumber} disconnected`)
                if (isDebugListenerError(debuggee)) {
                    log(`Debugger ${this.sessionNumber} reconnecting to ${this.connId}`)
                    // reconnect
                    break
                }
                log(`Debugger ${this.sessionNumber} on connection  ${this.connId} reached a breakpoint`)
                this.onBreakpointReached(debuggee)
            } catch (error) {
                if (!this.active) return
                if (!isAdtError(error)) {
                    this.ui.ShowError(`Error listening to debugger: ${caughtToString(error)}`)
                } else {
                    // autoAttachTimeout
                    const exceptionType = errorType(error)
                    switch (exceptionType) {
                        case "conflictNotification":
                        case "conflictDetected":
                            const txt = error?.properties?.conflictText || "Debugger terminated by another session/user"
                            this.ui.ShowError(txt)
                            await this.stopDebugging(false)
                            break
                        case ATTACHTIMEOUT:
                            // this.refresh()
                            break
                        default:
                            const elapsed = new Date().getTime() - startTime
                            if (elapsed < 50000) { // greater is likely a timeout
                                const quit = await this.ui.Confirmator(`Error listening to debugger: ${caughtToString(error)} Close session?`)
                                if (quit) await this.stopDebugging()
                            }
                    }
                }
            }
        }
    }

    private async stopThread(threadid: number) {
        const thread = this.services.get(threadid)
        this.services.delete(threadid)
        if (this.currentThreadId === threadid) this.currentThreadId = undefined
        if (thread) {
            await this.breakpointManager.removeAllBreakpoints(thread).catch(ignore)
            await thread.client.debuggerStep("stepContinue").catch(ignore)
            await thread.logout()
        }
    }

    private async onBreakpointReached(debuggee: Debuggee) {
        try {
            const service = await DebugService.create(this.connId,
                this.ui, this.username, this.mode, debuggee)
            const threadid = this.nextthreadid()
            service.threadId = threadid
            this.services.set(threadid, service)
            const creation = (async () => {
                await service.attach()
                service.addListener(e => {
                    if (e instanceof ThreadEvent && e.body.reason === THREAD_EXITED) this.stopThread(threadid)
                    this.notifier.fire(e)
                })
                this.currentThreadId = threadid
                this.notifier.fire(new StoppedEvent("breakpoint", threadid))
            })()
            this.threadCreation = creation.finally(() => this.threadCreation = undefined)
            await creation
        } catch (error) {
            log(`${error}`)
            await this.stopDebugging()
        }
    }

    nextthreadid(): number {
        if (this.services.size === 0) return 1
        const indexes = [...this.services.keys()]
        const max = Math.max(...indexes)
        if (max < this.services.size) for (let i = 1; i < max; i++)
            if (!this.services.has(i)) return i
        return max + 1
    }

    public async stopDebugging(stopDebugger = true) {
        this.active = false
        this.notifier.fire(new TerminatedEvent())
    }

    public async logout() {
        this.active = false
        if (this.killed) return
        this.killed = true
        const stop = this.listening && this.stopListener().catch(ignore)
        await stop
        if (this.listening) await this.stopListener()
        const stopServices = [...this.services.keys()].map(s => this.stopThread(s))
        const proms: Promise<any>[] = [...stopServices]

        await Promise.all(proms)
    }
}
